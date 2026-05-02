import { type ReactNode } from "react";
import { CSV_SCENARIO_PUBLIC_PATH } from "@/lib/projection";
import type { Account, Checkpoint, Posting, ProjectionRuntimeSettings, ScenarioPack } from "@/lib/projection";
import type { ScenarioValidationIssue } from "@/lib/projection";
import { ScenarioValidationPanel } from "./ScenarioValidationPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currency, integer, decimal, pluralize } from "@/lib/format";
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

interface TableColumn<TRow> {
  key: keyof TRow;
  label: string;
  format?: (value: TRow[keyof TRow], row: TRow) => string;
  render?: (value: TRow[keyof TRow], row: TRow, rowIndex: number) => ReactNode;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? integer.format(value) : decimal.format(value);
  if (Array.isArray(value)) return value.join(" ; ");
  return String(value);
}

function formatCurrency(v: unknown) {
  return typeof v === "number" ? currency.format(v) : formatValue(v);
}

function formatLoadedAt(dataUpdatedAt: number) {
  return dataUpdatedAt === 0 ? "Not loaded yet" : new Date(dataUpdatedAt).toLocaleString();
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
  title, description, rows, columns, emptyText = "No rows.",
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
              {columns.map((c) => <TableHead key={String(c.key)}>{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? rows.map((row, ri) => (
              <TableRow key={`${title}-${ri}`}>
                {columns.map((c) => {
                  const v = row[c.key as keyof TRow];
                  return (
                    <TableCell key={String(c.key)}>
                      {c.render ? c.render(v, row, ri) : (c.format ? c.format(v, row) : formatValue(v))}
                    </TableCell>
                  );
                })}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-6 text-center text-slate-500">{emptyText}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function inputStyle(isDirty: boolean) {
  const dirty = isDirty ? "border-amber-300 bg-amber-50" : "border-slate-200";
  return `w-full rounded-lg ${dirty} px-2 py-1 text-sm outline-none font-mono text-xs`;
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
            <SummaryCard label="Checkpoints" value={integer.format(displayPack?.checkpoints.length ?? 0)} />
            <SummaryCard label="Postings" value={integer.format(displayPack?.postings.length ?? 0)} />
          </div>
        ) : null}

        {pack ? (
          <div className="space-y-4">
            <CollapsibleSection title="Runtime settings and postings" description="Session-only settings and scheduled flows.">
              <div className="space-y-4">
                <DataTable
                  title="Runtime projection settings"
                  description="Session-only settings not stored in the data pack."
                  rows={[{ projectionStartDate, fallbackProjectionStartDate: projectionSettings.fallbackProjectionStartDate, horizonYears: projectionSettings.horizonYears, targetNetWorth: projectionSettings.targetNetWorth }]}
                  columns={[
                    { key: "projectionStartDate" as never, label: "Projection Start Date" },
                    { key: "fallbackProjectionStartDate" as never, label: "Fallback Start Date" },
                    { key: "horizonYears" as never, label: "Horizon Years" },
                    { key: "targetNetWorth" as never, label: "Target Net Worth", format: (v) => formatCurrency(v) },
                  ]}
                />

                {displayPack ? (
                  isEditing ? (
                    /* ---- editable postings ---- */
                    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
                      <CardHeader><CardTitle>Postings</CardTitle><CardDescription>Edit, add, or remove posting rows.</CardDescription></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>ID</TableHead><TableHead>Label</TableHead><TableHead>Source</TableHead>
                              <TableHead>Destinations</TableHead><TableHead>Arithmetic</TableHead>
                              <TableHead>Freq</TableHead><TableHead>Rate</TableHead><TableHead>Growth</TableHead><TableHead>Vol</TableHead>
                              <TableHead>Start</TableHead><TableHead>End</TableHead>
                              <TableHead>Cap</TableHead><TableHead>Pri</TableHead>
                              <TableHead>Enabled</TableHead><TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {displayPack.postings.map((p, pi) => {
                              const changed = isDirty && workingPack?.postings[pi] &&
                                JSON.stringify(workingPack.postings[pi]) !== JSON.stringify(pack.postings[pi]);
                              return (
                                <TableRow key={p.id}>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.id}
                                    onChange={(e) => updatePosting(p.id, { id: e.target.value })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.label}
                                    onChange={(e) => updatePosting(p.id, { label: e.target.value })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.sourceAccountId ?? ""}
                                    onChange={(e) => updatePosting(p.id, { sourceAccountId: e.target.value || null })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.destinations?.join(";") ?? ""}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      updatePosting(p.id, { destinations: raw.trim() ? raw.split(";").map(s => s.trim()) : null });
                                    }} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.arithmetic}
                                    onChange={(e) => updatePosting(p.id, { arithmetic: e.target.value })} /></TableCell>
                                  <TableCell>
                                    <select className={inputStyle(!!changed)} value={p.frequency}
                                      onChange={(e) => updatePosting(p.id, { frequency: e.target.value as Posting["frequency"] })}>
                                      <option value="daily">daily</option>
                                      <option value="weekly">weekly</option>
                                      <option value="monthly">monthly</option>
                                      <option value="quarterly">quarterly</option>
                                      <option value="annual">annual</option>
                                    </select>
                                  </TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" step={0.01} value={p.annualRate}
                                    onChange={(e) => updatePosting(p.id, { annualRate: Number(e.target.value) })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" step={0.01} value={p.annualGrowthRate}
                                    onChange={(e) => updatePosting(p.id, { annualGrowthRate: Number(e.target.value) })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" min={0} step={0.01} value={p.volatility}
                                    onChange={(e) => updatePosting(p.id, { volatility: Number(e.target.value) })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.startDate}
                                    onChange={(e) => updatePosting(p.id, { startDate: e.target.value })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={p.endDate ?? ""}
                                    onChange={(e) => updatePosting(p.id, { endDate: e.target.value || null })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" min={0} value={p.annualCap ?? ""}
                                    onChange={(e) => updatePosting(p.id, { annualCap: e.target.value ? Number(e.target.value) : null })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" min={1} value={p.priority}
                                    onChange={(e) => updatePosting(p.id, { priority: Math.max(1, Number(e.target.value)) })} /></TableCell>
                                  <TableCell>
                                    <input type="checkbox" className="h-4 w-4 rounded accent-slate-700" checked={p.enabled}
                                      onChange={() => updatePosting(p.id, { enabled: !p.enabled })} />
                                  </TableCell>
                                  <TableCell>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => deletePosting(p.id)}>✕</Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                        <div className="mt-3">
                          <Button type="button" variant="ghost" size="sm" onClick={() => addPosting(
                            { id: "new-posting-" + Date.now(), label: "New posting", sourceAccountId: null, destinations: null, arithmetic: "0", frequency: "monthly", annualRate: 0, annualGrowthRate: 0, volatility: 0, startDate: projectionStartDate, endDate: null, annualCap: null, priority: 1, enabled: true }
                          )}>+ Add posting</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    /* ---- read-only postings ---- */
                    <DataTable
                      title="Postings"
                      description="Scheduled flows. Checkbox toggles what-if disable (immediate)."
                      rows={pack.postings}
                      columns={[
                        { key: "id" as never, label: "ID" },
                        { key: "label" as never, label: "Label" },
                        { key: "sourceAccountId" as never, label: "Source" },
                        { key: "destinations" as never, label: "Destinations" },
                        { key: "arithmetic" as never, label: "Arithmetic" },
                        { key: "frequency" as never, label: "Freq" },
                        { key: "annualRate" as never, label: "Rate" },
                        { key: "annualGrowthRate" as never, label: "Growth" },
                        { key: "volatility" as never, label: "Vol" },
                        { key: "startDate" as never, label: "Start" },
                        { key: "endDate" as never, label: "End" },
                        { key: "annualCap" as never, label: "Cap", format: (v) => v === null ? "-" : formatCurrency(v) },
                        { key: "priority" as never, label: "Pri" },
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
                  )
                ) : null}
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Accounts and checkpoints" description="Raw account rows and historical checkpoint evidence.">
              <div className="space-y-4">
                {displayPack ? (
                  isEditing ? (
                    /* ---- editable accounts ---- */
                    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
                      <CardHeader><CardTitle>Accounts</CardTitle><CardDescription>Edit, add, or remove account rows.</CardDescription></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>ID</TableHead><TableHead>Label</TableHead>
                              <TableHead>Min</TableHead><TableHead>Max</TableHead>
                              <TableHead>Color</TableHead><TableHead>Enabled</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {displayPack.accounts.map((a) => {
                              const changed = isDirty && workingPack?.accounts.some(wa => wa.id === a.id &&
                                JSON.stringify(wa) !== JSON.stringify(pack.accounts.find(pa => pa.id === a.id)));
                              return (
                                <TableRow key={a.id}>
                                  <TableCell><input className={inputStyle(!!changed)} value={a.id}
                                    onChange={(e) => updateAccount(a.id, { id: e.target.value })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={a.label}
                                    onChange={(e) => updateAccount(a.id, { label: e.target.value })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" value={a.minBalance ?? ""}
                                    onChange={(e) => updateAccount(a.id, { minBalance: e.target.value ? Number(e.target.value) : null })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} type="number" value={a.maxBalance ?? ""}
                                    onChange={(e) => updateAccount(a.id, { maxBalance: e.target.value ? Number(e.target.value) : null })} /></TableCell>
                                  <TableCell><input className={inputStyle(!!changed)} value={a.color ?? ""}
                                    onChange={(e) => updateAccount(a.id, { color: e.target.value || null })} /></TableCell>
                                  <TableCell>
                                    <input type="checkbox" className="h-4 w-4 rounded accent-slate-700" checked={a.enabled}
                                      onChange={() => updateAccount(a.id, { enabled: !a.enabled })} />
                                  </TableCell>
                                  <TableCell>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => deleteAccount(a.id)}>✕</Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                        <div className="mt-3">
                          <Button type="button" variant="ghost" size="sm" onClick={() => addAccount(
                            { id: "new-account-" + Date.now(), label: "New account", minBalance: null, maxBalance: null, color: null, enabled: true }
                          )}>+ Add account</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    /* ---- read-only accounts ---- */
                    <DataTable
                      title="Accounts"
                      description="Tracked signed balances. Checkbox toggles what-if disable (immediate)."
                      rows={pack.accounts}
                      columns={[
                        { key: "id" as never, label: "ID" },
                        { key: "label" as never, label: "Label" },
                        { key: "minBalance" as never, label: "Min", format: (v) => v === null ? "-" : formatCurrency(v) },
                        { key: "maxBalance" as never, label: "Max", format: (v) => v === null ? "-" : formatCurrency(v) },
                        { key: "color" as never, label: "Color" },
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
                  )
                ) : null}

                {displayPack ? (
                  isEditing ? (
                    /* ---- editable checkpoints ---- */
                    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
                      <CardHeader><CardTitle>Checkpoints</CardTitle><CardDescription>Edit, add, or remove checkpoint rows.</CardDescription></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead><TableHead>Account ID</TableHead><TableHead>Balance</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {displayPack.checkpoints.map((c, ci) => (
                              <TableRow key={ci}>
                                <TableCell><input className={inputStyle(!!isDirty)} value={c.Date}
                                  onChange={(e) => updateCheckpoint(ci, { Date: e.target.value })} /></TableCell>
                                <TableCell><input className={inputStyle(!!isDirty)} value={c.AccountId}
                                  onChange={(e) => updateCheckpoint(ci, { AccountId: e.target.value })} /></TableCell>
                                <TableCell><input className={inputStyle(!!isDirty)} type="number" value={c.Balance}
                                  onChange={(e) => updateCheckpoint(ci, { Balance: Number(e.target.value) })} /></TableCell>
                                <TableCell>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => deleteCheckpoint(ci)}>✕</Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="mt-3">
                          <Button type="button" variant="ghost" size="sm" onClick={() => addCheckpoint(
                            { Date: projectionStartDate, AccountId: "", Balance: 0 }
                          )}>+ Add checkpoint</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    /* ---- read-only checkpoints ---- */
                    <DataTable
                      title="Checkpoints"
                      description="Historical account balance checkpoints."
                      rows={pack.checkpoints}
                      columns={[
                        { key: "Date" as never, label: "Date" },
                        { key: "AccountId" as never, label: "Account ID" },
                        { key: "Balance" as never, label: "Balance", format: (v) => formatCurrency(v) },
                      ]}
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
