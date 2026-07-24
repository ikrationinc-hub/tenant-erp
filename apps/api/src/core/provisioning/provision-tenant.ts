import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../config/db.js";
import { ConflictError } from "../../common/errors/index.js";
import { withTenantSchema } from "../../database/get-db.js";
import { applyPendingTenantMigrations } from "../../database/migration-runner.js";
import { tenants } from "../../database/platform/schema.js";
import { branches, companies, countries, currencies } from "../../database/tenant/schema.js";
import { slugToTenantSchemaName } from "../../database/tenant/schema-name.js";
import { insertAuditLog } from "../audit/write.js";
import { INVITE_TOKEN_TTL_MS, generateInviteToken } from "../auth/invite-token.js";
import { getMailer } from "../notification/mailer.js";
import { buildInviteEmail } from "../notification/templates/invite-email.js";
import { RESOLVED_MODULES, resolveModuleClosure } from "../module-registry/registry.js";
import { setModuleEnabled } from "../module-registry/tenant-modules.js";
import { seedPermissionCatalogue } from "../rbac/seed.js";
import {
  findActiveUserByEmail,
  insertInvitation,
  insertInvitedUser,
} from "../../modules/users/users.repository.js";
import { seedDefaultRoles } from "./seed-roles.js";
import { seedDefaultMenuTree } from "./seed-menu-tree.js";
import { seedDefaultFieldDefinitions } from "./seed-field-definitions.js";
import { seedDefaultNumberSeries } from "./seed-number-series.js";
import { seedMasterData } from "../masters/seed-data.js";

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  modules: string[];
}

export interface ProvisionTenantResult {
  tenantId: string;
  schemaName: string;
  companyId: string;
  branchId: string;
  adminUserId: string;
  /** True only the very first time this slug is provisioned - a re-run always returns false, even though it still re-applies every idempotent seed step. */
  created: boolean;
}

const DEFAULT_COMPANY_DEFAULTS = {
  fiscalYearStartMonth: 1,
  timezone: "UTC",
} as const;

/** ISO codes seedMasterData's COUNTRY_SEEDS/CURRENCY_SEEDS always include - the default company's country_id/currency_id backfill target. */
const DEFAULT_COUNTRY_CODE = "US";
const DEFAULT_CURRENCY_CODE = "USD";

/**
 * Drops the schema and removes the platform.tenants row - task item 3:
 * "On failure at any step: drop the schema, clean the platform row. Never
 * leave a half-provisioned tenant." Only ever called for a BRAND NEW
 * tenant that hasn't reached 'active' yet; re-provisioning an existing
 * active tenant never calls this (see reProvisionExistingTenant) - a
 * failed re-run must not destroy a tenant that was already working.
 */
async function cleanupFailedProvisioning(schemaName: string, tenantId: string | undefined): Promise<void> {
  await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`);
  if (tenantId) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
}

async function createDefaultCompanyAndBranch(
  schemaName: string,
  companyName: string,
  createdBy: string,
): Promise<{ companyId: string; branchId: string }> {
  return withTenantSchema(schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: companyName, createdBy, ...DEFAULT_COMPANY_DEFAULTS })
      .returning();
    if (!company) {
      throw new Error("failed to insert default company");
    }

    const [branch] = await tx
      .insert(branches)
      .values({ companyId: company.id, name: "Head Office", code: "HO", createdBy })
      .returning();
    if (!branch) {
      throw new Error("failed to insert default branch");
    }

    return { companyId: company.id, branchId: branch.id };
  });
}

/**
 * The default company is created before countries/currencies exist for it
 * (both are company-scoped masters, FK'd to this very company row - see
 * schema.ts's doc comment on companies.countryId/currencyId), so it starts
 * with both columns null. Once seedMasterData has run, the US/USD rows it
 * always seeds (seed-data.ts's COUNTRY_SEEDS/CURRENCY_SEEDS) exist for this
 * company - this backfills the two columns from them.
 */
async function backfillDefaultCountryAndCurrency(schemaName: string, companyId: string): Promise<void> {
  await withTenantSchema(schemaName, async (tx) => {
    const [country] = await tx
      .select({ id: countries.id })
      .from(countries)
      .where(and(eq(countries.companyId, companyId), eq(countries.code, DEFAULT_COUNTRY_CODE), isNull(countries.deletedAt)))
      .limit(1);
    const [currency] = await tx
      .select({ id: currencies.id })
      .from(currencies)
      .where(and(eq(currencies.companyId, companyId), eq(currencies.code, DEFAULT_CURRENCY_CODE), isNull(currencies.deletedAt)))
      .limit(1);

    await tx
      .update(companies)
      .set({
        ...(country ? { countryId: country.id } : {}),
        ...(currency ? { currencyId: currency.id } : {}),
      })
      .where(eq(companies.id, companyId));
  });
}

/**
 * The tenant admin's user row is created FIRST, before roles/menu/field-
 * definitions/number-series, specifically so every one of those can use
 * the admin's own id as createdBy - more truthful than the initiating
 * platform admin's id (which isn't even a valid users.id in this schema
 * to begin with, though nothing here is FK-constrained on createdBy). The
 * invitation row is created LATER, once the Admin role exists to assign -
 * see inviteProvisionedAdmin below.
 */
async function createInvitedAdminUser(
  schemaName: string,
  companyId: string,
  adminEmail: string,
  adminName: string,
  createdBy: string,
): Promise<string> {
  return withTenantSchema(schemaName, async (tx) => {
    const existing = await findActiveUserByEmail(tx, adminEmail);
    if (existing) {
      throw new ConflictError(`A user with email "${adminEmail}" already exists`);
    }
    const user = await insertInvitedUser(tx, { companyId, email: adminEmail, name: adminName, createdBy });
    return user.id;
  });
}

/**
 * invited_by is a NOT NULL FK to users.id (see docs/adr/0006), and there
 * is no other real tenant-side user yet at this point in a brand-new
 * tenant's provisioning - the admin is recorded as their own inviter, a
 * deliberate bootstrap convention (not a bug): the row must reference
 * SOME valid users.id, and the invitee's own id, already committed by
 * createInvitedAdminUser above, is the only one that both exists and is
 * truthful about what actually happened here.
 */
async function inviteProvisionedAdmin(
  schemaName: string,
  companyId: string,
  adminUserId: string,
  adminEmail: string,
  adminRoleId: string,
  companyName: string,
  tenantSlug: string,
): Promise<void> {
  const { token, tokenHash } = generateInviteToken();

  await withTenantSchema(schemaName, async (tx) => {
    await insertInvitation(tx, {
      companyId,
      email: adminEmail,
      tokenHash,
      roles: [adminRoleId],
      invitedBy: adminUserId,
      expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    });

    await insertAuditLog(tx, {
      companyId,
      entity: "user",
      entityId: adminUserId,
      action: "user.invited",
      after: { email: adminEmail, roles: [adminRoleId], status: "invited" },
    });
  });

  await getMailer().send(buildInviteEmail({ to: adminEmail, companyName, token, tenantSlug }));
}

async function applyModuleEnablement(tenantId: string, schemaName: string, requestedModules: string[]): Promise<void> {
  const enabledClosure = resolveModuleClosure(requestedModules);
  for (const manifest of RESOLVED_MODULES) {
    // Sequential, not batched: a handful of modules, run once per provisioning call
    await setModuleEnabled(tenantId, schemaName, manifest.key, enabledClosure.has(manifest.key));
  }
}

async function provisionNewTenant(
  input: ProvisionTenantInput,
  initiatedBy: string,
): Promise<ProvisionTenantResult> {
  const schemaName = slugToTenantSchemaName(input.slug);
  let tenantId: string | undefined;

  try {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: input.name, slug: input.slug, schemaName })
      .returning();
    if (!tenant) {
      throw new Error("failed to insert tenant row");
    }
    tenantId = tenant.id;

    await applyPendingTenantMigrations(schemaName);
    await seedPermissionCatalogue(schemaName);

    const { companyId, branchId } = await createDefaultCompanyAndBranch(schemaName, input.name, initiatedBy);

    const adminUserId = await createInvitedAdminUser(
      schemaName,
      companyId,
      input.adminEmail,
      input.adminName,
      initiatedBy,
    );

    // Not assigned here: the invitation's `roles: [roleIdsByName.Admin]`
    // below (matching the existing invite flow's own semantics exactly -
    // docs/adr/0006) is what actually grants it, at accept time. Doing
    // both would double-assign and violate user_roles' unique constraint -
    // caught by this task's own end-to-end accept+login test.
    const roleIdsByName = await seedDefaultRoles({ schemaName, companyId, createdBy: adminUserId });

    await seedDefaultMenuTree({ schemaName, companyId, createdBy: adminUserId });
    await seedDefaultFieldDefinitions({ schemaName, companyId, createdBy: adminUserId });
    await seedDefaultNumberSeries({ schemaName, companyId, createdBy: adminUserId });
    await seedMasterData({ schemaName, companyId, createdBy: adminUserId });
    await backfillDefaultCountryAndCurrency(schemaName, companyId);

    await applyModuleEnablement(tenant.id, schemaName, input.modules);

    await inviteProvisionedAdmin(
      schemaName,
      companyId,
      adminUserId,
      input.adminEmail,
      roleIdsByName.Admin,
      input.name,
      input.slug,
    );

    const [activated] = await db
      .update(tenants)
      .set({ status: "active" })
      .where(eq(tenants.id, tenant.id))
      .returning();
    if (!activated) {
      throw new Error("failed to activate tenant");
    }

    return { tenantId: activated.id, schemaName, companyId, branchId, adminUserId, created: true };
  } catch (error) {
    await cleanupFailedProvisioning(schemaName, tenantId);
    throw error;
  }
}

/**
 * Idempotent re-run (task item 2): only the naturally idempotent seed
 * steps (permission catalogue, field_definitions, number series,
 * reference masters, module enablement - each an upsert/onConflict... on
 * its own natural key) are re-applied. Default roles, the menu tree, and
 * the admin invite are skipped entirely once they exist - core/rbac/
 * mutations.ts's createRole and core/menu-engine/mutations.ts's
 * createMenu have no "already exists" handling of their own, so calling
 * them again would throw on the unique constraint rather than no-op.
 * Never touches schema/platform-row cleanup: a failure here must not
 * destroy a tenant that was already working.
 */
async function reProvisionExistingTenant(
  existingTenant: typeof tenants.$inferSelect,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  const { schemaName } = existingTenant;

  await applyPendingTenantMigrations(schemaName);
  await seedPermissionCatalogue(schemaName);

  const { companyId, branchId } = await withTenantSchema(schemaName, async (tx) => {
    const [company] = await tx.select().from(companies).limit(1);
    if (!company) {
      throw new Error(`Tenant "${input.slug}" is active but has no company - inconsistent state`);
    }
    const [branch] = await tx.select().from(branches).where(eq(branches.companyId, company.id)).limit(1);
    if (!branch) {
      throw new Error(`Tenant "${input.slug}" is active but has no branch - inconsistent state`);
    }
    return { companyId: company.id, branchId: branch.id };
  });

  const adminUser = await withTenantSchema(schemaName, (tx) => findActiveUserByEmail(tx, input.adminEmail));

  await seedDefaultFieldDefinitions({ schemaName, companyId, createdBy: adminUser?.id ?? existingTenant.id });
  await seedDefaultNumberSeries({ schemaName, companyId, createdBy: adminUser?.id ?? existingTenant.id });
  await seedMasterData({ schemaName, companyId, createdBy: adminUser?.id ?? existingTenant.id });
  await applyModuleEnablement(existingTenant.id, schemaName, input.modules);

  return {
    tenantId: existingTenant.id,
    schemaName,
    companyId,
    branchId,
    adminUserId: adminUser?.id ?? "",
    created: false,
  };
}

export async function provisionTenant(
  input: ProvisionTenantInput,
  initiatedBy: string,
): Promise<ProvisionTenantResult> {
  const [existingTenant] = await db.select().from(tenants).where(eq(tenants.slug, input.slug)).limit(1);

  if (existingTenant) {
    if (existingTenant.status !== "active") {
      throw new ConflictError(
        `Tenant "${input.slug}" already exists in an unexpected state: ${existingTenant.status}`,
      );
    }
    return reProvisionExistingTenant(existingTenant, input);
  }

  return provisionNewTenant(input, initiatedBy);
}
