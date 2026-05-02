import { CSV_SCENARIO_PUBLIC_PATH } from "@/lib/projection";
import type { ScenarioPack, ProjectionRuntimeSettings, ScenarioValidationIssue } from "@/lib/projection";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currency, integer, decimal, pluralize } from "@/lib/format";

interface ScenarioInspectorProps {
  pack: ScenarioPack | null;
  issues: ScenarioValidationIssue[];
  loadError: string | null;
  isLoading: boolean;
  loadedAt: Date | null;
  projectionSettings: ProjectionRuntimeSettings;
  projectionStartDate: string;
  onReload: () => void;
}

interface TableColumn<TRow> {
  key: keyof TRow;
  label: string;
  format?: (value: TRow[keyof TRow], row: TRow) => string;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? integer.format(value) : decimal.format(value);
  }

  return String(value);
}

function formatCurrency(value: unknown) {
  return typeof value === "number" ? currency.format(value) : formatValue(value);
}

function formatLoadedAt(loadedAt: Date | null) {
  if (loadedAt === null) {
    return "Not loaded yet";
  }

  return loadedAt.toLocaleString();
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm" className="rounded-[1.4rem] border-slate-200">
      <CardContent className="space-y-1 p-4">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
        <div className="text-lg font-semibold text-slate-900">{value}</div>
      </CardContent>
    </Card>
  );
}

function DataTable<TRow extends object>({
  title,
  description,
  rows,
  columns,
  emptyText = "No rows.",
}: {
  title: string;
  description: string;
  rows: TRow[];
  columns: TableColumn<TRow>[];
  emptyText?: string;
}) {
  return (
    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={String(column.key)}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <TableRow key={`${title}-${rowIndex}`}>
                  {columns.map((column) => {
                    const value = row[column.key as keyof TRow];

                    return (
                      <TableCell key={String(column.key)}>
                        {column.format ? column.format(value, row) : formatValue(value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-6 text-center text-slate-500">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function ScenarioInspector({
  pack,
  issues,
  loadError,
  isLoading,
  loadedAt,
  projectionSettings,
  projectionStartDate,
  onReload,
}: ScenarioInspectorProps) {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const shouldOpen = loadError !== null || issues.length > 0;
  const loadStatus = isLoading ? "Loading" : loadError ? "Load failed" : pack ? "Loaded" : "Waiting";
  const validationSummary = errorCount > 0
    ? pluralize(errorCount, "error")
    : warningCount > 0
      ? pluralize(warningCount, "warning")
      : pack
        ? "Clean"
        : "Pending";

  return (
    <CollapsibleSection
      open={shouldOpen}
      title="Source data and validation"
      description="Secondary inspection area for data health, runtime settings, and raw source tables."
      badge={`${loadStatus} • ${validationSummary}`}
    >
      <div className="space-y-5">
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onReload} disabled={isLoading}>
            {isLoading ? "Loading..." : "Reload"}
          </Button>
        </div>

        {loadError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Data pack could not be loaded</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        {issues.length > 0 ? <ScenarioValidationPanel issues={issues} /> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Source path" value={CSV_SCENARIO_PUBLIC_PATH} />
          <SummaryCard label="Last loaded" value={formatLoadedAt(loadedAt)} />
          <SummaryCard label="Projection start" value={projectionStartDate} />
          <SummaryCard label="Target" value={currency.format(projectionSettings.targetNetWorth)} />
        </div>

        {pack ? (
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard label="Accounts" value={integer.format(pack.accounts.length)} />
            <SummaryCard label="Checkpoints" value={integer.format(pack.checkpoints.length)} />
            <SummaryCard label="Postings" value={integer.format(pack.postings.length)} />
          </div>
        ) : null}

        {pack ? (
          <div className="space-y-4">
            <CollapsibleSection
              title="Runtime settings and postings"
              description="Use this only when you need to verify the exact inputs behind the forecast."
            >
              <div className="space-y-4">
                <DataTable
                  title="Runtime projection settings"
                  description="Session-only settings that are not stored in the CSV pack."
                  rows={[{
                    projectionStartDate,
                    fallbackProjectionStartDate: projectionSettings.fallbackProjectionStartDate,
                    horizonYears: projectionSettings.horizonYears,
                    targetNetWorth: projectionSettings.targetNetWorth,
                  }]}
                  columns={[
                    { key: "projectionStartDate", label: "Projection Start Date" },
                    { key: "fallbackProjectionStartDate", label: "Fallback Start Date" },
                    { key: "horizonYears", label: "Horizon Years" },
                    { key: "targetNetWorth", label: "Target Net Worth", format: (value) => formatCurrency(value) },
                  ]}
                />

                <DataTable
                  title="Postings"
                  description="Scheduled inflows, outflows, and transfers. Blank source or destination means an external flow."
                  rows={pack.postings}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "label", label: "Label" },
                    { key: "sourceAccountId", label: "Source" },
                    { key: "destinations", label: "Destinations", format: (value) => Array.isArray(value) ? value.join(" ; ") : "-" },
                    { key: "arithmetic", label: "Arithmetic" },
                    { key: "annualGrowthRate", label: "Annual Growth" },
                    { key: "startDate", label: "Start Date" },
                    { key: "endDate", label: "End Date" },
                    { key: "annualCap", label: "Annual Cap", format: (value) => value === null ? "-" : formatCurrency(value) },
                    { key: "priority", label: "Priority" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Accounts and checkpoints"
              description="Open for the raw account rows and historical checkpoint evidence."
            >
              <div className="space-y-4">
                <DataTable
                  title="Accounts"
                  description="Tracked signed balances that contribute directly to net worth."
                  rows={pack.accounts}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "label", label: "Label" },
                    { key: "category", label: "Category" },
                    { key: "annualRate", label: "Annual Rate" },
                    { key: "minBalance", label: "Min Balance", format: (value) => value === null ? "-" : formatCurrency(value) },
                    { key: "maxBalance", label: "Max Balance", format: (value) => value === null ? "-" : formatCurrency(value) },
                    { key: "color", label: "Color" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />

                <DataTable
                  title="Checkpoints"
                  description="Historical account balance checkpoints from checkpoints.csv."
                  rows={pack.checkpoints}
                  columns={[
                    { key: "Date", label: "Date" },
                    { key: "AccountId", label: "Account ID" },
                    { key: "Balance", label: "Balance", format: (value) => formatCurrency(value) },
                  ]}
                />
              </div>
            </CollapsibleSection>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
