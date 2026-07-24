import { eq } from "drizzle-orm";
import { db } from "../../config/db.js";
import { NotFoundError } from "../../common/errors/index.js";
import { withTenantSchema } from "../../database/get-db.js";
import { tenants } from "../../database/platform/schema.js";
import { branches, companies } from "../../database/tenant/schema.js";
import { assignDefaultRole, seedDefaultRoles } from "./seed-roles.js";
import { seedDefaultMenuTree } from "./seed-menu-tree.js";
import { seedDefaultFieldDefinitions } from "./seed-field-definitions.js";
import { seedDefaultNumberSeries } from "./seed-number-series.js";

export interface ProvisionCompanyInput {
  tenantSlug: string;
  name: string;
  /** Optional: unlike provision-tenant.ts's default company, this path never seeds countries/currencies for the new company (see this function's own doc comment) - a caller can only supply an id if it already knows of one, e.g. a country/currency shared across the tenant's other companies. */
  countryId?: string;
  currencyId?: string;
  fiscalYearStartMonth: number;
  timezone: string;
  adminUserId: string;
}

export interface ProvisionCompanyResult {
  companyId: string;
  branchId: string;
}

/**
 * Adding a second legal entity to an ALREADY-provisioned tenant (task
 * item 5) - no schema/migration/permission-catalogue work, that's tenant-
 * level and already done. Reuses the exact same seed-* steps
 * provision-tenant.ts calls for a brand new tenant's default company,
 * parameterized by the new companyId, so a second company gets the same
 * default roles/menu/field-definitions/number-series a first one does -
 * reference masters are deliberately NOT re-seeded here (tenant-wide, no
 * company_id, already seeded once for this tenant).
 */
export async function provisionCompany(input: ProvisionCompanyInput): Promise<ProvisionCompanyResult> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, input.tenantSlug)).limit(1);
  if (!tenant || tenant.status !== "active") {
    throw new NotFoundError(`No active tenant found for slug "${input.tenantSlug}"`);
  }

  const { companyId, branchId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        name: input.name,
        ...(input.countryId !== undefined ? { countryId: input.countryId } : {}),
        ...(input.currencyId !== undefined ? { currencyId: input.currencyId } : {}),
        fiscalYearStartMonth: input.fiscalYearStartMonth,
        timezone: input.timezone,
        createdBy: input.adminUserId,
      })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }

    const [branch] = await tx
      .insert(branches)
      .values({ companyId: company.id, name: "Head Office", code: "HO", createdBy: input.adminUserId })
      .returning();
    if (!branch) {
      throw new Error("failed to insert default branch");
    }

    return { companyId: company.id, branchId: branch.id };
  });

  const roleIdsByName = await seedDefaultRoles({
    schemaName: tenant.schemaName,
    companyId,
    createdBy: input.adminUserId,
  });
  await assignDefaultRole(tenant.schemaName, companyId, input.adminUserId, roleIdsByName.Admin, input.adminUserId);

  await seedDefaultMenuTree({ schemaName: tenant.schemaName, companyId, createdBy: input.adminUserId });
  await seedDefaultFieldDefinitions({ schemaName: tenant.schemaName, companyId, createdBy: input.adminUserId });
  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: input.adminUserId });

  return { companyId, branchId };
}
