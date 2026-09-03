import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";

interface ClauseOption {
  id: string;
  clauseTitle: string;
  clauseCode: string;
}
interface ClausesListResponse {
  items: ClauseOption[];
}

export interface AddClauseFromLibraryProps {
  divisionId?: string;
  onAdd: (clauseId: string) => void;
}

/** Item 8: "Add-from-library (filtered by division + contract type)" - contract type isn't its own filterable dimension on the clause library (C-1 never scoped clauses by contract type, only division/category), so this filters by division alone, matching what GET /clauses actually supports. */
export function AddClauseFromLibrary({ divisionId, onAdd }: AddClauseFromLibraryProps): ReactElement {
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);

  const clausesQuery = useQuery({
    queryKey: ["clause-library-options", divisionId],
    queryFn: () => apiFetch<ClausesListResponse>(withQuery(endpoints.clauses, { divisionId, pageSize: "200" }), {}, {}),
  });

  const options = (clausesQuery.data?.items ?? []).map((clause) => ({ value: clause.id, label: `${clause.clauseCode} — ${clause.clauseTitle}` }));

  return (
    <Space>
      <Select
        placeholder="Add a clause from the library"
        style={{ width: 360 }}
        value={selectedClauseId}
        onChange={setSelectedClauseId}
        options={options}
        loading={clausesQuery.isLoading}
        showSearch
        optionFilterProp="label"
        aria-label="Add clause from library"
      />
      <Button
        icon={<PlusOutlined />}
        disabled={!selectedClauseId}
        onClick={() => {
          if (selectedClauseId) {
            onAdd(selectedClauseId);
            setSelectedClauseId(null);
          }
        }}
      >
        Add
      </Button>
    </Space>
  );
}
