import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../config/db.js";
import { withTenantSchema } from "../../database/get-db.js";
import {
  platformAdmins,
  platformLoginHistory,
  platformRefreshTokens,
  tenantModules,
  tenants,
} from "../../database/platform/schema.js";
import { users } from "../../database/tenant/schema.js";

export type PlatformAdminRow = typeof platformAdmins.$inferSelect;
export type PlatformRefreshTokenRow = typeof platformRefreshTokens.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;
export type TenantModuleRow = typeof tenantModules.$inferSelect;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function findPlatformAdminByEmail(email: string): Promise<PlatformAdminRow | undefined> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email)).limit(1);
  return admin;
}

export async function findPlatformAdminById(id: string): Promise<PlatformAdminRow | undefined> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, id)).limit(1);
  return admin;
}

export interface InsertPlatformAdminInput {
  email: string;
  passwordHash: string;
  name: string;
}

/**
 * Not exposed over HTTP - platform admins are "you/Knackroot" (docs/
 * Hyperion-ERP-Backend-Plan-v2.md), manually provisioned, not a self-
 * service signup. Exists for tests and the bootstrap seed script
 * (scripts/seed-platform-admin.ts).
 */
export async function insertPlatformAdmin(input: InsertPlatformAdminInput): Promise<PlatformAdminRow> {
  const [admin] = await db.insert(platformAdmins).values(input).returning();
  if (!admin) {
    throw new Error("failed to insert platform admin");
  }
  return admin;
}

export interface InsertPlatformRefreshTokenInput {
  id: string;
  platformAdminId: string;
  familyId: string;
  expiresAt: Date;
}

export async function insertPlatformRefreshToken(input: InsertPlatformRefreshTokenInput): Promise<void> {
  await db.insert(platformRefreshTokens).values(input);
}

export async function findPlatformRefreshTokenById(
  id: string,
): Promise<PlatformRefreshTokenRow | undefined> {
  const [row] = await db.select().from(platformRefreshTokens).where(eq(platformRefreshTokens.id, id)).limit(1);
  return row;
}

/** Rotation: this token is superseded by `replacedById`, never usable again. */
export async function markPlatformRefreshTokenRotated(id: string, replacedById: string): Promise<void> {
  await db
    .update(platformRefreshTokens)
    .set({ revokedAt: new Date(), replacedById, updatedAt: new Date() })
    .where(eq(platformRefreshTokens.id, id));
}

/** Reuse detected, or an explicit logout: the whole rotation lineage is over, not just one token. */
export async function revokePlatformRefreshTokenFamily(familyId: string): Promise<void> {
  await db
    .update(platformRefreshTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(platformRefreshTokens.familyId, familyId), isNull(platformRefreshTokens.revokedAt)));
}

export interface InsertPlatformLoginHistoryInput {
  platformAdminId?: string;
  attemptedEmail: string;
  outcome: "success" | "failure";
  reason?: string;
  ip?: string;
  userAgent?: string;
}

export async function insertPlatformLoginHistory(input: InsertPlatformLoginHistoryInput): Promise<void> {
  await db.insert(platformLoginHistory).values(input);
}

export interface TenantListRow extends TenantRow {
  moduleCount: number;
  userCount: number;
}

/**
 * userCount is a lightweight per-tenant COUNT(*), never a row-level browse
 * of tenant.users (ADM-2 task item 1's explicit distinction) - one
 * aggregate query per tenant, run against that tenant's own schema through
 * withTenantSchema, same as any other cross-tenant-safe operation in this
 * codebase.
 */
export async function listTenants(): Promise<TenantListRow[]> {
  const tenantRows = await db.select().from(tenants).orderBy(tenants.createdAt);

  return Promise.all(
    tenantRows.map(async (tenant) => {
      const [moduleCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenantModules)
        .where(and(eq(tenantModules.tenantId, tenant.id), eq(tenantModules.enabled, true)));

      const userCount =
        tenant.status === "provisioning"
          ? 0
          : await withTenantSchema(tenant.schemaName, async (tx) => {
              const [row] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(users)
                .where(isNull(users.deletedAt));
              return row?.count ?? 0;
            });

      return { ...tenant, moduleCount: moduleCountRow?.count ?? 0, userCount };
    }),
  );
}

export async function findTenantById(id: string): Promise<TenantRow | undefined> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return tenant;
}

export async function listTenantModules(tenantId: string): Promise<TenantModuleRow[]> {
  return db.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
}

export async function updateTenantStatus(
  id: string,
  status: TenantRow["status"],
): Promise<TenantRow | undefined> {
  const [tenant] = await db
    .update(tenants)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenants.id, id))
    .returning();
  return tenant;
}
