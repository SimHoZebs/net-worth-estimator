import { useState } from "react";
import type { DataSource, ProjectionRuntimeSettings, ScenarioPack } from "@/lib/projection";
import type { ScenarioValidationIssue } from "@/lib/projection";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SummaryCard } from "@/components/ui/summary-card";
import { DataTable, formatCurrency } from "@/components/ui/data-table";
import { EditablePostingsTable } from "@/components/dashboard/tables/EditablePostingsTable";
import { EditableAccountsTable } from "@/components/dashboard/tables/EditableAccountsTable";
import { EditableCheckpointsTable } from "@/components/dashboard/tables/EditableCheckpointsTable";
import { ReadOnlyPostingsTable } from "@/components/dashboard/tables/ReadOnlyPostingsTable";
import { ReadOnlyAccountsTable } from "@/components/dashboard/tables/ReadOnlyAccountsTable";
import { ReadOnlyCheckpointsTable } from "@/components/dashboard/tables/ReadOnlyCheckpointsTable";
import { currency, integer, pluralize } from "@/lib/format";
import { useStore } from "@/store";

interface ScenarioInspectorProps {
  projectionSettings: ProjectionRuntimeSettings;
  projectionStartDate: string;
  pack: ScenarioPack | null;
  issues: ScenarioValidationIssue[];
  dataSource: DataSource;
  isLoading: boolean;
  loadError: string | null;
  sourceActionError: string | null;
  dataUpdatedAt: number;
  onReload: () => void;
  onSave: () => void;
  onResetSource?: () => void;
  isSaving: boolean;
  isResetting: boolean;
}

function formatLoadedAt(dataUpdatedAt: number) {
  return dataUpdatedAt === 0 ? "Not loaded yet" : new Date(dataUpdatedAt).toLocaleString();
}

export function ScenarioInspector({
  projectionSettings, projectionStartDate, pack, issues, dataSource, isLoading, loadError, sourceActionError, dataUpdatedAt, onReload, onSave, onResetSource, isSaving, isResetting,
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
  const shouldOpen = loadError !== null || sourceActionError !== null || issues.length > 0;
  const loadStatus = isLoading ? "Loading" : loadError ? "Load failed" : sourceActionError ? "Action failed" : pack ? "Loaded" : "Waiting";
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
              <Button type="button" size="sm" onClick={onSave} disabled={!isDirty || !dataSource.save || isSaving}>
                {isSaving ? "Saving..." : dataSource.save?.label ?? "Save unavailable"}
              </Button>
            </>
          ) : (
            <>
              {dataSource.reset && onResetSource ? (
                <Button type="button" variant="ghost" size="sm" onClick={onResetSource} disabled={isLoading || isResetting}>
                  {isResetting ? "Resetting..." : dataSource.reset.label}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" size="sm" onClick={onReload} disabled={isLoading}>
                {isLoading ? "Loading..." : "Reload"}
              </Button>
              {pack && dataSource.save ? <Button type="button" variant="secondary" size="sm" onClick={() => startEditing(pack)}>Edit</Button> : null}
            </>
          )}
        </div>

        <p className="text-xs text-slate-500">{dataSource.description}</p>

        {loadError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Data pack could not be loaded</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        {sourceActionError ? (
          <Alert variant="destructive" className="rounded-[1.6rem]">
            <AlertTitle>Source action failed</AlertTitle>
            <AlertDescription>{sourceActionError}</AlertDescription>
          </Alert>
        ) : null}

        {issues.length > 0 ? <ScenarioValidationPanel issues={issues} /> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Source" value={dataSource.label} />
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
                    <ReadOnlyPostingsTable
                      postings={pack.postings}
                      showAdvanced={showAdvanced}
                      disabledPostingSet={disabledPostingSet}
                      onToggle={togglePostingDisabled}
                      search={postingSearch}
                      onSearchChange={setPostingSearch}
                    />
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
                    <ReadOnlyAccountsTable
                      accounts={pack.accounts}
                      showAdvanced={showAdvanced}
                      disabledAccountSet={disabledAccountSet}
                      onToggle={toggleAccountDisabled}
                      search={accountSearch}
                      onSearchChange={setAccountSearch}
                    />
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
                    <ReadOnlyCheckpointsTable
                      checkpoints={pack.checkpoints}
                      showAdvanced={showAdvanced}
                      accountLabelById={accountLabelById}
                      search={checkpointSearch}
                      onSearchChange={setCheckpointSearch}
                    />
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
