import { CSV_SCENARIO_PUBLIC_PATH } from "@/lib/projection";
import type { CsvScenarioPack, ProjectionRuntimeSettings, ScenarioValidationIssue } from "@/lib/projection";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    return "Not loaded yet.";
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
  children: React.ReactNode;
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
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Expand</div>
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
  return (
    <div className="space-y-6">
      <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Data pack status</CardTitle>
            <CardDescription>
              The model reads canonical CSV data from <code>{`${CSV_SCENARIO_PUBLIC_PATH}/*.csv`}</code> and combines it with runtime projection settings in memory.
            </CardDescription>
          </div>
          <CardAction>
            <Button type="button" variant="secondary" onClick={onReload} disabled={isLoading}>
              {isLoading ? "Loading..." : "Reload CSVs"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard label="Source path" value={CSV_SCENARIO_PUBLIC_PATH} />
            <SummaryCard label="Load status" value={isLoading ? "Loading" : loadError ? "Load failed" : "Loaded"} />
            <SummaryCard label="Last loaded" value={formatLoadedAt(loadedAt)} />
          </div>
          {loadError ? (
            <Alert variant="destructive">
              <AlertTitle>CSV pack could not be loaded</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {pack || issues.length > 0 ? <ScenarioValidationPanel issues={issues} /> : null}

      {pack ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Planning setup</CardTitle>
                  <CardDescription>
                    These are the runtime settings that most directly affect whether the target is reached.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Projection start" value={projectionStartDate} />
                <SummaryCard label="Fallback start" value={projectionSettings.fallbackProjectionStartDate} />
                <SummaryCard label="Horizon" value={`${integerFormatter.format(projectionSettings.horizonYears)} years`} />
                <SummaryCard label="Target net worth" value={currencyFormatter.format(projectionSettings.targetNetWorth)} />
              </CardContent>
            </Card>

            <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Data inventory</CardTitle>
                  <CardDescription>
                    Useful for checking coverage, but secondary to the forecast itself.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <SummaryCard label="Accounts" value={integerFormatter.format(pack.accounts.length)} />
                <SummaryCard label="Checkpoints" value={integerFormatter.format(pack.checkpoints.length)} />
                <SummaryCard label="Budget items" value={integerFormatter.format(pack.budgetItems.length)} />
                <SummaryCard label="Contribution plans" value={integerFormatter.format(pack.contributionPlans.length)} />
                <SummaryCard label="Transfers" value={integerFormatter.format(pack.transfers.length)} />
              </CardContent>
            </Card>
          </div>

          <Alert className="rounded-[1.6rem] border-sky-200 bg-sky-50 text-sky-950">
            <AlertTitle>Projection model rules</AlertTitle>
            <AlertDescription className="text-sky-950/80">
              <code>budget_items</code> define dated contribution capacity only. <code>contribution_plans</code>, <code>transfers</code>, and account <code>annualRate</code> values change future balances. Historical rows come from exact checkpoint dates.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <SectionDisclosure
              title="Core projection inputs"
              description="Open to inspect the runtime settings and plan definitions that most affect the projection."
              defaultOpen
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
                  title="Contribution Plans"
                  description="Future balance-changing contributions into tracked accounts."
                  rows={pack.contributionPlans}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "label", label: "Label" },
                    { key: "targetAccountId", label: "Target Account" },
                    { key: "calculationMode", label: "Calculation Mode" },
                    { key: "baseBudgetItemId", label: "Base Budget Item" },
                    { key: "amount", label: "Amount" },
                    { key: "startDate", label: "Start Date" },
                    { key: "endDate", label: "End Date" },
                    { key: "annualCap", label: "Annual Cap", format: (value) => value === null ? "-" : formatCurrency(value) },
                    { key: "priority", label: "Priority" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />

                <DataTable
                  title="Accounts"
                  description="Tracked signed balances that contribute to net worth."
                  rows={pack.accounts}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "label", label: "Label" },
                    { key: "category", label: "Category" },
                    { key: "openingBalance", label: "Opening Balance", format: (value) => formatCurrency(value) },
                    { key: "annualRate", label: "Annual Rate" },
                    { key: "color", label: "Color" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />
              </div>
            </SectionDisclosure>

            <SectionDisclosure
              title="Supporting assumptions"
              description="Budget capacity and transfer rules that influence the projection indirectly or conditionally."
            >
              <div className="space-y-4">
                <DataTable
                  title="Budget Items"
                  description="Dated income and spending assumptions used only for contribution-capacity math."
                  rows={pack.budgetItems}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "label", label: "Label" },
                    { key: "direction", label: "Direction" },
                    { key: "parentBudgetItemId", label: "Parent" },
                    { key: "amountMode", label: "Amount Mode" },
                    { key: "amount", label: "Amount", format: (value, row) => row.amountMode === "fixed" ? formatCurrency(value) : formatValue(value) },
                    { key: "annualGrowthRate", label: "Annual Growth" },
                    { key: "startDate", label: "Start Date" },
                    { key: "endDate", label: "End Date" },
                    { key: "category", label: "Category" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />

                <DataTable
                  title="Transfers"
                  description="Optional moves between tracked accounts."
                  rows={pack.transfers}
                  emptyText="No transfers are defined in transfers.csv."
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "label", label: "Label" },
                    { key: "sourceAccountId", label: "Source" },
                    { key: "destinationAccountId", label: "Destination" },
                    { key: "amountMode", label: "Amount Mode" },
                    { key: "amount", label: "Amount", format: (value) => formatCurrency(value) },
                    { key: "startDate", label: "Start Date" },
                    { key: "endDate", label: "End Date" },
                    { key: "enabled", label: "Enabled" },
                  ]}
                />
              </div>
            </SectionDisclosure>

            <SectionDisclosure
              title="Historical evidence"
              description="Checkpoint rows backing the historical part of the timeline."
            >
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
            </SectionDisclosure>
          </div>
        </>
      ) : null}
    </div>
  );
}
