import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, Space } from "antd";
import { myCompaniesResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { queryClient } from "../../core/api/query-client";
import { useAppStore } from "../../core/store/app-store";

/**
 * Re-scoping company or branch invalidates the ENTIRE query cache (no
 * filter) - stale data from another company on screen is a correctness
 * bug, not a UX nit.
 */
export function CompanyBranchSwitcher(): ReactElement | null {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const activeBranchId = useAppStore((s) => s.activeBranchId);
  const setActiveScope = useAppStore((s) => s.setActiveScope);

  const companiesQuery = useQuery({
    queryKey: ["users", "me", "companies"],
    queryFn: () => apiFetch(endpoints.myCompanies, {}, { schema: myCompaniesResponseSchema }),
    staleTime: 5 * 60_000,
  });

  const companies = companiesQuery.data?.companies ?? [];
  const activeCompany = companies.find((company) => company.id === activeCompanyId);
  const branches = activeCompany?.branches ?? [];

  function handleCompanyChange(companyId: string): void {
    setActiveScope({ companyId, branchId: null });
    void queryClient.invalidateQueries();
  }

  function handleBranchChange(branchId: string): void {
    setActiveScope({ companyId: activeCompanyId, branchId });
    void queryClient.invalidateQueries();
  }

  if (companies.length === 0) {
    return null;
  }

  return (
    <Space size="small">
      <Select
        size="small"
        style={{ minWidth: 160 }}
        value={activeCompanyId}
        onChange={handleCompanyChange}
        options={companies.map((company) => ({ label: company.name, value: company.id }))}
        aria-label="Company"
      />
      <Select
        size="small"
        style={{ minWidth: 140 }}
        value={activeBranchId}
        onChange={handleBranchChange}
        options={branches.map((branch) => ({ label: branch.name, value: branch.id }))}
        placeholder="Branch"
        disabled={branches.length === 0}
        aria-label="Branch"
      />
    </Space>
  );
}
