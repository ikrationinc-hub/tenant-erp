import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { permissions, roles, rolePermissions, users, companies, clauses, clauseVersions, clauseRules } from "../src/database/tenant/schema.js";
import { seedPermissionCatalogue } from "../src/core/rbac/seed.js";
import { grantPermissionToRole } from "../src/core/rbac/mutations.js";
import { nextNumber } from "../src/core/numbering/next-number.js";
import { promoteDueVersions } from "../src/modules/contract/clause-promotion.js";
import { and, isNull } from "drizzle-orm";

/**
 * One-off, C-4 (docs/CONTRACT-MODULE-BUILD.md): two gaps an already-active
 * tenant never picks up on its own (seedPermissionCatalogue/module manifests
 * only run at (re)provisioning time - same reasoning as every prior
 * backfill-*.ts in this directory):
 *
 * 1. The new contract.document.email/esign/run_rules and contract.rule.
 *    read/create/update permission keys (core/module-registry/manifests.ts)
 *    need granting to existing roles, mirroring backfill-contract-clause-
 *    permissions.ts's exact shape.
 * 2. ⚠️ EXAMPLE clause_rules, per the spec's own explicit instruction: "seed
 *    2-3 EXAMPLE rules clearly marked as examples (e.g. CIF -> insurance)."
 *    These are NOT real client-provided rules - every row this script
 *    inserts has isExample=true and a clauseTitle/clauseCode that says so
 *    in plain text, so nobody mistakes it for a rule the client actually
 *    asked for (see clause-rules.service.ts's own doc comment on why
 *    isExample can never be set any other way).
 */
const NEW_PERMISSION_KEYS = [
  "contract.document.email",
  "contract.document.esign",
  "contract.document.run_rules",
  "contract.rule.read",
  "contract.rule.create",
  "contract.rule.update",
] as const;
const ROLE_ACTION_FILTERS: Record<string, (action: string) => boolean> = {
  Viewer: (action) => action === "read",
  Officer: (action) => ["read", "create", "update", "version", "edit", "generate", "email", "run_rules"].includes(action),
  Manager: (action) =>
    ["read", "create", "update", "approve", "confirm", "issue", "cancel", "record", "assign", "provision", "assemble", "edit", "generate", "email", "esign", "run_rules"].includes(
      action,
    ),
  Admin: () => true,
};

interface PendingGrant {
  companyId: string;
  roleId: string;
  roleName: string;
  permissionId: string;
  permissionKey: string;
  createdBy: string;
}

async function backfillPermissions(schemaName: string): Promise<void> {
  await seedPermissionCatalogue(schemaName);

  const pending = await withTenantSchema(schemaName, async (tx) => {
    const newPermissionRows = await tx.select().from(permissions).where(eq(permissions.module, "contract"));
    const relevant = newPermissionRows.filter((p) => (NEW_PERMISSION_KEYS as readonly string[]).includes(p.key));

    const roleRows = await tx.select().from(roles);
    const existingGrants = await tx.select().from(rolePermissions);
    const grantedSet = new Set(existingGrants.map((g) => `${g.roleId}:${g.permissionId}`));

    const result: PendingGrant[] = [];
    for (const role of roleRows) {
      const filter = role.isSystem ? ROLE_ACTION_FILTERS[role.name] : undefined;
      if (!filter) continue;

      const [anyUser] = await tx.select().from(users).where(eq(users.companyId, role.companyId)).limit(1);
      if (!anyUser) continue;

      for (const permission of relevant) {
        if (!filter(permission.action)) continue;
        if (grantedSet.has(`${role.id}:${permission.id}`)) continue;

        result.push({
          companyId: role.companyId,
          roleId: role.id,
          roleName: role.name,
          permissionId: permission.id,
          permissionKey: permission.key,
          createdBy: anyUser.id,
        });
      }
    }
    return result;
  });

  for (const grant of pending) {
    await grantPermissionToRole(schemaName, grant.companyId, grant.roleId, grant.permissionId, grant.createdBy);
    logger.info({ schemaName, role: grant.roleName, permission: grant.permissionKey }, "granted");
  }
}

const EXAMPLE_CLAUSE_CODE_MARKER = "EXAMPLE - Insurance (CIF)";
const EXAMPLE_RULE_NAME = "EXAMPLE: CIF shipments require an insurance clause";

/**
 * Idempotent per company: if this company already has the example clause
 * (matched by clauseTitle, since clauseCode is auto-numbered and not a
 * stable key across runs) or the example rule (matched by name), skip it.
 * Only ever runs against companies that have NO divisions requirement -
 * divisionId is left null (applies to all divisions), matching this
 * example's own generic nature.
 */
async function seedExampleForCompany(schemaName: string, companyId: string, createdBy: string): Promise<"seeded" | "already-present"> {
  return withTenantSchema(schemaName, async (tx) => {
    const [existingClause] = await tx
      .select()
      .from(clauses)
      .where(and(eq(clauses.companyId, companyId), eq(clauses.clauseTitle, EXAMPLE_CLAUSE_CODE_MARKER), isNull(clauses.deletedAt)))
      .limit(1);

    let clauseId: string;
    if (existingClause) {
      clauseId = existingClause.id;
    } else {
      const clauseCode = await nextNumber(tx, { companyId, docType: "CLAUSE", date: new Date() });
      const [clause] = await tx
        .insert(clauses)
        .values({
          companyId,
          clauseCode,
          clauseTitle: EXAMPLE_CLAUSE_CODE_MARKER,
          category: "general_tc",
          createdBy,
        })
        .returning();
      if (!clause) throw new Error("failed to insert example clause");
      clauseId = clause.id;

      const [version] = await tx
        .insert(clauseVersions)
        .values({
          companyId,
          clauseId,
          versionNumber: 1,
          clauseText:
            "[EXAMPLE CLAUSE - not client-confirmed legal text] The Seller shall arrange and pay for marine insurance covering the goods for the duration of the voyage, in accordance with Incoterms CIF.",
          status: "approved",
          effectiveFrom: new Date().toISOString().slice(0, 10),
          changeReason: "C-4 example seed - proves the rule engine end-to-end, not real legal text",
          approvedBy: createdBy,
          approvedAt: new Date(),
          createdBy,
        })
        .returning();
      if (!version) throw new Error("failed to insert example clause version");
      await promoteDueVersions(tx);
    }

    const [existingRule] = await tx.select().from(clauseRules).where(and(eq(clauseRules.companyId, companyId), eq(clauseRules.name, EXAMPLE_RULE_NAME))).limit(1);
    if (existingRule) {
      return "already-present";
    }

    await tx.insert(clauseRules).values({
      companyId,
      name: EXAMPLE_RULE_NAME,
      conditionJson: {
        all: [{ fact: "deliveryTerms", operator: "equal", value: "Cost, Insurance and Freight" }],
      },
      targetClauseId: clauseId,
      actionIsMandatory: true,
      isActive: true,
      isExample: true,
      createdBy,
    });

    return "seeded";
  });
}

async function seedExamplesForTenant(schemaName: string): Promise<void> {
  const companyRows = await withTenantSchema(schemaName, (tx) => tx.select().from(companies).where(isNull(companies.deletedAt)));

  for (const company of companyRows) {
    const [anyUser] = await withTenantSchema(schemaName, (tx) => tx.select().from(users).where(eq(users.companyId, company.id)).limit(1));
    if (!anyUser) {
      logger.info({ schemaName, companyId: company.id }, "skipped example rule seed - no user to attribute createdBy to");
      continue;
    }

    const result = await seedExampleForCompany(schemaName, company.id, anyUser.id);
    logger.info({ schemaName, companyId: company.id, companyName: company.name, result }, "example CIF->insurance rule");
  }
}

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
  for (const tenant of activeTenants) {
    await backfillPermissions(tenant.schemaName);
    await seedExamplesForTenant(tenant.schemaName);
    console.log(`  ${tenant.slug} (${tenant.schemaName}): done`);
  }
  console.log(`\nOK: ${activeTenants.length} tenant(s) processed\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "C-4 permission + example-rule backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
