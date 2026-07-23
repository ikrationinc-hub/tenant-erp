import type { ReactElement } from "react";
import { RecordScreen } from "../../core/record-screen/RecordScreen";

/** A normal schema-driven screen (FE-5.5) - no special-casing. Fields (name, country, currency, fiscal_year_start_month, timezone, tax_registration_no, status) all come from field-definitions. */
export function CompanyScreen(): ReactElement {
  return <RecordScreen module="admin" entity="company" endpoint="/companies" label="Companies" />;
}
