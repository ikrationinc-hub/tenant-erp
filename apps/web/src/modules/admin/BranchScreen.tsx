import type { ReactElement } from "react";
import { RecordScreen } from "../../core/record-screen/RecordScreen";

/**
 * Same generic shape as CompanyScreen. company_id is never a rendered
 * field - the backend injects it from the request's tenant scope
 * (ctx.tenantScope.companyId), the same way every other entity's
 * company_id is set (backend rule 2: scope comes from the JWT, never a
 * form field). field-definitions for "branch" simply never declares one.
 */
export function BranchScreen(): ReactElement {
  return <RecordScreen module="admin" entity="branch" endpoint="/branches" label="Branches" />;
}
