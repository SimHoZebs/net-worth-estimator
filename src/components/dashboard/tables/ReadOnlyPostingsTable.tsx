import type { Posting } from "@/lib/projection";
import { DataTable } from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import { formatCurrency } from "@/components/ui/data-table";
import { formatFrequency } from "@/lib/format";

interface ReadOnlyPostingsTableProps {
  postings: Posting[];
  showAdvanced: boolean;
  disabledPostingSet: Set<string>;
  onToggle: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
}

export function ReadOnlyPostingsTable({
  postings, showAdvanced, disabledPostingSet, onToggle, search, onSearchChange,
}: ReadOnlyPostingsTableProps) {
  return (
    <div>
      <TableSearch value={search} onChange={onSearchChange} placeholder="Search transactions..." />
      <DataTable
        title="Postings"
        description="Scheduled flows. Checkbox toggles what-if disable (immediate)."
        rows={postings.filter((p) =>
          !search || p.label.toLowerCase().includes(search.toLowerCase()) || p.id.toLowerCase().includes(search.toLowerCase())
        )}
        variant="flat"
        columns={[
          ...(showAdvanced ? [{ key: "id" as never, label: "ID" }] : []),
          { key: "label" as never, label: "Transaction" },
          ...(showAdvanced ? [{ key: "sourceAccountId" as never, label: "Source" }] : []),
          { key: "destinations" as never, label: "To" },
          ...(showAdvanced ? [{ key: "arithmetic" as never, label: "Formula" }] : []),
          { key: "frequency" as never, label: "Freq", format: (v: unknown) => formatFrequency(String(v)) },
          ...(showAdvanced ? [
            { key: "annualRate" as never, label: "Rate" },
            { key: "annualGrowthRate" as never, label: "Growth" },
            { key: "volatility" as never, label: "Vol" },
          ] : []),
          { key: "startDate" as never, label: "Start" },
          { key: "endDate" as never, label: "End" },
          ...(showAdvanced ? [
            { key: "annualCap" as never, label: "Cap", format: (v: unknown) => v === null ? "-" : formatCurrency(v) },
            { key: "priority" as never, label: "Pri" },
          ] : []),
          {
            key: "enabled" as never, label: "Enabled",
            render: (_v: unknown, row: object) => {
              const p = row as Posting;
              return <input type="checkbox" className="h-4 w-4 rounded accent-slate-700" checked={!disabledPostingSet.has(p.id)}
                onChange={() => onToggle(p.id)} />;
            },
          },
        ]}
      />
    </div>
  );
}
