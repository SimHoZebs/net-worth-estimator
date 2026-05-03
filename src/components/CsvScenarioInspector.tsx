import { useState } from "react";
import { CSV_SCENARIO_PUBLIC_PATH } from "@/lib/projection";
import { NO_FLOOR, NO_CEILING } from "@/lib/projection/constants";
import type { Account, Checkpoint, Posting, ProjectionRuntimeSettings, ScenarioPack } from "@/lib/projection";
import type { ScenarioValidationIssue } from "@/lib/projection";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SummaryCard } from "@/components/ui/summary-card";
import { DataTable, formatCurrency } from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import { ColorSwatch } from "@/components/dashboard/ColorSwatch";
import { EditablePostingsTable } from "@/components/dashboard/EditablePostingsTable";
import { EditableAccountsTable } from "@/components/dashboard/EditableAccountsTable";
import { EditableCheckpointsTable } from "@/components/dashboard/EditableCheckpointsTable";
import { filterRows } from "@/lib/filter-rows";
import { currency, integer, pluralize, formatFrequency } from "@/lib/format";
import { useStore } from "@/store";

interface ScenarioInspectorProps {
  projectionSettings: ProjectionRuntimeSettings;
  projectionStartDate: string;
  pack: ScenarioPack | null;
  issues: ScenarioValidationIssue[];
  isLoading: boolean;
  loadError: string | null;
  dataUpdatedAt: number;
  onReload: () => void;
  onSave: () => void;
}

function formatLoadedAt(dataUpdatedAt: number) {
  return dataUpdatedAt === 0 ? "Not loaded yet" : new Date(dataUpdatedAt).toLocaleString();
}

export function ScenarioInspector({
  projectionSettings, projectionStartDate, pack, issues, isLoading, loadError, dataUpdatedAt, onReload, onSave,
}: ScenarioInspectorProps) {
  const disabledAccountIds = useStore((s) => s.disabledAccountIds);
  const disabledPostingIds = useStore((s) => s.disabledPostingIds);
  const toggleAccountDisabled = useStore((s) => s.toggleAccountDisabled);
  const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
  const isEditing = useStore((s) => s.isEditing);
  const isDirty = useStore((s) => s.isDirty);
  const workingPack = useStore((s) => s.workingPack);
  const startEditing = useStore((s) => s.startEditing);
  const cancelEditing = useStore((s) => s.cancelEditing);
  const updateAccount = useStore((s) => s.updateAccount);
  const deleteAccount = useStore((s) => s.deleteAccount);
  const addAccount = useStore((s) => s.addAccount);
  const updatePosting = useStore((s) => s.updatePosting);
  const deletePosting = useStore((s) => s.deletePosting);
  const addPosting = useStore((s) => s.addPosting);
  const addCheckpoint = useStore((s) => s.addCheckpoint);
  const deleteCheckpoint = useStore((s) => s.deleteCheckpoint);
  const updateCheckpoint = useStore((s) => s.updateCheckpoint);
  const disabledAccountSet = new Set(disabledAccountIds);
  const disabledPostingSet = new Set(disabledPostingIds);
  const displayPack = isEditing && workingPack ? workingPack : pack;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [postingSearch, setPostingSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [checkpointSearch, setCheckpointSearch] = useState("");

  const accountLabelById = new Map(pack?.accounts.map((a) => [a.id, a.label]) ?? []);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const shouldOpen = loadError !== null || issues.length > 0;
  const loadStatus = isLoading ? "Loading" : loadError ? "Load failed" : pack ? "Loaded" : "Waiting";
  const validationSummary = errorCount > 0 ? pluralize(errorCount, "error")
    : warningCount > 0 ? pluralize(warningCount, "warning")
    : pack ? "Clean" : "Pending";

  return (
    <CollapsibleSection
      open={shouldOpen}
      title="Source data and validation"
      description="Secondary inspection area for data health, runtime settings, and raw source tables."
      badge={`${loadStatus} • ${validationSummary}`}
    >
      <div className="space-y-5">
        {/* Top bar: reload + edit/save/cancel */}
        <div className="flex justify-end gap-2">
          {isEditing ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={cancelEditing}>Cancel</Button>
              <Button type="button" size="sm" onClick={onSave} disabled={!isDirty}>Save changes</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={onReload} disabled={isLoading}>
                {isLoading ? "Loading..." : "Reload"}
              </Button>
              {pack ? <Button type="button" variant="secondary" size="sm" onClick={() => startEditing(pack)}>Edit</Button> : null}
            </>
          )}
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
          <SummaryCard label="Last loaded" value={formatLoadedAt(dataUpdatedAt)} />
          <SummaryCard label="Projection start" value={projectionStartDate} />
          <SummaryCard label="Target" value={currency.format(projectionSettings.targetNetWorth)} />
        </div>

        {pack ? (
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard label="Accounts" value={integer.format(displayPack?.accounts.length ?? 0)} />
            <SummaryCard label="Balance history" value={integer.format(displayPack?.checkpoints.length ?? 0)} />
            <SummaryCard label="Scheduled transactions" value={integer.format(displayPack?.postings.length ?? 0)} />
          </div>
        ) : null}

        {!isEditing && pack ? (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
            >
              {showAdvanced ? "Hide raw IDs and formulas" : "Show raw IDs and formulas"}
            </button>
          </div>
        ) : null}

        {pack ? (
          <div className="space-y-4">
            <CollapsibleSection title="Projection settings and scheduled transactions" description="Session-only settings and scheduled flows.">
              <div className="space-y-4">
                <DataTable
                  title="Runtime projection settings"
                  description="Session-only settings not stored in the data pack."
                  rows={[{ projectionStartDate, fallbackProjectionStartDate: projectionSettings.fallbackProjectionStartDate, horizonYears: projectionSettings.horizonYears, targetNetWorth: projectionSettings.targetNetWorth }]}
                  variant="flat"
                  columns={[
                    { key: "projectionStartDate" as never, label: "Projection Start Date" },
                    { key: "fallbackProjectionStartDate" as never, label: "Fallback Start Date" },
                    { key: "horizonYears" as never, label: "Horizon Years" },
                    { key: "targetNetWorth" as never, label: "Target Net Worth", format: (v) => formatCurrency(v) },
                  ]}
                />

                {displayPack ? (
                  isEditing ? (
                    <EditablePostingsTable
                      displayPack={displayPack}
                      pack={pack}
                      isDirty={isDirty}
                      workingPack={workingPack}
                      projectionStartDate={projectionStartDate}
                      updatePosting={updatePosting}
                      deletePosting={deletePosting}
                      addPosting={addPosting}
                    />
                  ) : (
                    /* ---- read-only postings ---- */
                    <div>
                      <TableSearch value={postingSearch} onChange={setPostingSearch} placeholder="Search transactions..." />
                      <DataTable
                        title="Postings"
                        description="Scheduled flows. Checkbox toggles what-if disable (immediate)."
                        rows={filterRows(pack.postings, postingSearch)}
                        variant="flat"
                        columns={[
                          ...(showAdvanced ? [{ key: "id" as never, label: "ID" }] : []),
                          { key: "label" as never, label: "Transaction" },
                          ...(showAdvanced ? [{ key: "sourceAccountId" as never, label: "Source" }] : []),
                          { key: "destinations" as never, label: "To" },
                          ...(showAdvanced ? [{ key: "arithmetic" as never, label: "Formula" }] : []),
                          { key: "frequency" as never, label: "Freq", format: (v) => formatFrequency(String(v)) },
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
                            render: (_v, row) => {
                              const p = row as Posting;
                              return <input type="checkbox" className="h-4 w-4 rounded accent-slate-700" checked={!disabledPostingSet.has(p.id)}
                                onChange={() => togglePostingDisabled(p.id)} />;
                            },
                          },
                        ]}
                      />
                    </div>
                  )
                ) : null}
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Accounts and balance history" description="Raw account rows and historical balance checkpoints.">
              <div className="space-y-4">
                {displayPack ? (
                  isEditing ? (
                    <EditableAccountsTable
                      displayPack={displayPack}
                      pack={pack}
                      isDirty={isDirty}
                      workingPack={workingPack}
                      updateAccount={updateAccount}
                      deleteAccount={deleteAccount}
                      addAccount={addAccount}
                    />
                  ) : (
                    /* ---- read-only accounts ---- */
                    <div>
                      <TableSearch value={accountSearch} onChange={setAccountSearch} placeholder="Search accounts..." />
                      <DataTable
                        title="Accounts"
                        description="Tracked signed balances. Checkbox toggles what-if disable (immediate)."
                        rows={filterRows(pack.accounts, accountSearch)}
                        variant="flat"
                        columns={[
                          ...(showAdvanced ? [{ key: "id" as never, label: "ID" }] : []),
                          { key: "label" as never, label: "Account" },
                          { key: "minBalance" as never, label: "Min", format: (v: unknown) => v === NO_FLOOR ? "-" : formatCurrency(v) },
                          { key: "maxBalance" as never, label: "Max", format: (v: unknown) => v === NO_CEILING ? "-" : formatCurrency(v) },
                          {
                            key: "color" as never, label: "Color",
                            render: (_v, row) => <ColorSwatch color={(row as Account).color} />,
                          },
                          {
                            key: "enabled" as never, label: "Enabled",
                            render: (_v, row) => {
                              const a = row as Account;
                              return <input type="checkbox" className="h-4 w-4 rounded accent-slate-700" checked={!disabledAccountSet.has(a.id)}
                                onChange={() => toggleAccountDisabled(a.id)} />;
                            },
                          },
                        ]}
                      />
                    </div>
                  )
                ) : null}

                {displayPack ? (
                  isEditing ? (
                    <EditableCheckpointsTable
                      displayPack={displayPack}
                      isDirty={isDirty}
                      projectionStartDate={projectionStartDate}
                      updateCheckpoint={updateCheckpoint}
                      deleteCheckpoint={deleteCheckpoint}
                      addCheckpoint={addCheckpoint}
                    />
                  ) : (
                    /* ---- read-only checkpoints ---- */
                    <div>
                      <TableSearch value={checkpointSearch} onChange={setCheckpointSearch} placeholder="Search checkpoints..." />
                      <DataTable
                        title="Balance history"
                        description="Historical account balance checkpoints."
                        rows={filterRows(pack.checkpoints, checkpointSearch)}
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
                  )
                ) : null}
              </div>
            </CollapsibleSection>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
