import { useState } from "react";
import type { Checkpoint } from "@/lib/projection";
import { DataTable, formatCurrency } from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";

interface ReadOnlyCheckpointsTableProps {
  checkpoints: Checkpoint[];
  showAdvanced: boolean;
  accountLabelById: Map<string, string>;
}

export function ReadOnlyCheckpointsTable({
  checkpoints, showAdvanced, accountLabelById,
}: ReadOnlyCheckpointsTableProps) {
  const [search, setSearch] = useState("");

  return (
    <div>
      <TableSearch value={search} onChange={setSearch} placeholder="Search checkpoints..." />
      <DataTable
        title="Balance history"
        description="Historical account balance checkpoints."
        rows={checkpoints.filter((c) =>
          !search || c.Date.toLowerCase().includes(search.toLowerCase()) || c.AccountId.toLowerCase().includes(search.toLowerCase())
        )}
        variant="flat"
        columns={[
          { key: "Date" as never, label: "Date" },
          ...(showAdvanced
            ? [{ key: "AccountId" as never, label: "Account ID" }]
            : [{
                key: "AccountId" as never,
                label: "Account",
                render: (_v: unknown, row: object) => {
                  const accountId = (row as Checkpoint).AccountId;
                  return <span className="text-slate-700">{accountLabelById.get(accountId) ?? accountId}</span>;
                },
              }]),
          { key: "Balance" as never, label: "Balance", format: (v: unknown) => formatCurrency(v) },
        ]}
      />
    </div>
  );
}
