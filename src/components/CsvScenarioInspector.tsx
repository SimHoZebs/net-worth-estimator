import type { ReactNode } from "react";
import { CSV_SCENARIO_PUBLIC_PATH } from "@/lib/projection";
import type { CsvScenarioPack, ProjectionRuntimeSettings, ScenarioValidationIssue } from "@/lib/projection";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CsvScenarioInspectorProps {
  pack: CsvScenarioPack | null;
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

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? integerFormatter.format(value) : decimalFormatter.format(value);
  }

  return String(value);
}

function formatCurrency(value: unknown) {
  return typeof value === "number" ? currencyFormatter.format(value) : formatValue(value);
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

function SectionDisclosure({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-[1.6rem] border border-slate-200 bg-white px-4 py-4 shadow-sm open:border-slate-300"
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <div className="text-sm text-slate-500">{description}</div>
          </div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Open</div>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
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

export function CsvScenarioInspector({
  pack,
  issues,
  loadError,
  isLoading,
  loadedAt,
  projectionSettings,
  projectionStartDate,
  onReload,
}: CsvScenarioInspectorProps) {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const shouldOpen = loadError !== null || issues.length > 0;
  const loadStatus = isLoading ? "Loading" : loadError ? "Load failed" : pack ? "Loaded" : "Waiting";
  const validationSummary = errorCount > 0
    ? `${errorCount} error${errorCount === 1 ? "" : "s"}`
    : warningCount > 0
      ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
      : pack
        ? "Clean"
        : "Pending";

  return (
    <details open={shouldOpen} className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm open:border-slate-300">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-base font-semibold text-slate-900">Source data and validation</div>
            <div className="text-sm text-slate-500">Secondary inspection area for CSV health, runtime settings, and raw source tables.</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">{loadStatus}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">{validationSummary}</span>
          </div>
        </div>
      </summary>

      <div className="mt-5 space-y-5">
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onReload} disabled={isLoading}>
            {isLoading ? "Loading..." : "Reload CSVs"}
          </Button>
        </div>

        {loadError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>CSV pack could not be loaded</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        {issues.length > 0 ? <ScenarioValidationPanel issues={issues} /> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Source path" value={CSV_SCENARIO_PUBLIC_PATH} />
          <SummaryCard label="Last loaded" value={formatLoadedAt(loadedAt)} />
          <SummaryCard label="Projection start" value={projectionStartDate} />
          <SummaryCard label="Target" value={currencyFormatter.format(projectionSettings.targetNetWorth)} />
        </div>

        {pack ? (
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard label="Accounts" value={integerFormatter.format(pack.accounts.length)} />
            <SummaryCard label="Checkpoints" value={integerFormatter.format(pack.checkpoints.length)} />
            <SummaryCard label="Postings" value={integerFormatter.format(pack.postings.length)} />
          </div>
        ) : null}

        {pack ? (
          <div className="space-y-4">
            <SectionDisclosure
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
                    { key: "amountMode", label: "Amount Mode" },
                    { key: "basePostingId", label: "Base Posting" },
                    { key: "amount", label: "Amount", format: (value, row) => row.amountMode === "fixed" ? formatCurrency(value) : formatValue(value) },
                    { key: "annualGrowthRate", label: "Annual Growth" },
                    { key: "startDate", label: "Start Date" },
                    { key: "endDate", label: "End Date" },
                    { key: "annualCap", label: "Annual Cap", format: (value) => value === null ? "-" : formatCurrency(value) },
                    { key: "priority", label: "Priority" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />
              </div>
            </SectionDisclosure>

            <SectionDisclosure
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
                    { key: "openingBalance", label: "Opening Balance", format: (value) => formatCurrency(value) },
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
            </SectionDisclosure>
          </div>
        ) : null}
      </div>
    </details>
  );
}
