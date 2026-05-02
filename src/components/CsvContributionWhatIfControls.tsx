import { useState } from "react";
import type { Account, Checkpoint, Posting, ScenarioPack, ScenarioWhatIfState } from "@/lib/projection";
import { Button } from "@/components/ui/button";
import { currency, formatRoute } from "@/lib/format";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

interface ContributionWhatIfControlsProps {
  pack: ScenarioPack;
  whatIfState: ScenarioWhatIfState;
  activeOverrideCount: number;
  onResetAllOverrides: () => void;
  onAddTemporaryAccount: (account: Account) => void;
  onRemoveTemporaryAccount: (id: string) => void;
  onAddTemporaryPosting: (posting: Posting) => void;
  onRemoveTemporaryPosting: (id: string) => void;
  onAddTemporaryCheckpoint: (checkpoint: Checkpoint) => void;
  onRemoveTemporaryCheckpoint: (index: number) => void;
}

function describeRoute(posting: Posting, pack: ScenarioPack) {
  const accountById = new Map(pack.accounts.map((a) => [a.id, a]));
  const sourceLabel = posting.sourceAccountId ? (accountById.get(posting.sourceAccountId)?.label ?? posting.sourceAccountId) : null;
  const destinations = posting.destinations
    ? posting.destinations.map((destId) => ({ label: accountById.get(destId)?.label ?? destId }))
    : null;

  return formatRoute(sourceLabel, destinations);
}

function emptyAccount(): Account {
  return {
    id: "",
    label: "",
    minBalance: null,
    maxBalance: null,
    color: null,
    enabled: true,
  };
}

function emptyPosting(): Posting {
  return {
    id: "",
    label: "",
    sourceAccountId: null,
    destinations: null,
    arithmetic: "",
    frequency: "monthly",
    annualRate: 0,
    annualGrowthRate: 0,
    volatility: 0,
    startDate: "",
    endDate: null,
    annualCap: null,
    priority: 1,
    enabled: true,
  };
}

function emptyCheckpoint(): Checkpoint {
  return {
    Date: "",
    AccountId: "",
    Balance: 0,
  };
}

export function ContributionWhatIfControls({
  pack,
  whatIfState,
  activeOverrideCount,
  onResetAllOverrides,
  onAddTemporaryAccount,
  onRemoveTemporaryAccount,
  onAddTemporaryPosting,
  onRemoveTemporaryPosting,
  onAddTemporaryCheckpoint,
  onRemoveTemporaryCheckpoint,
}: ContributionWhatIfControlsProps) {
  const [addingAccount, setAddingAccount] = useState<Account | null>(null);
  const [addingPosting, setAddingPosting] = useState<Posting | null>(null);
  const [addingCheckpoint, setAddingCheckpoint] = useState<Checkpoint | null>(null);

  const commitAccount = () => {
    if (addingAccount && addingAccount.id.trim() && addingAccount.label.trim()) {
      onAddTemporaryAccount(addingAccount);
    }
    setAddingAccount(null);
  };

  const commitPosting = () => {
    if (addingPosting && addingPosting.id.trim()) {
      onAddTemporaryPosting(addingPosting);
    }
    setAddingPosting(null);
  };

  const commitCheckpoint = () => {
    if (addingCheckpoint && addingCheckpoint.Date.trim() && addingCheckpoint.AccountId.trim()) {
      onAddTemporaryCheckpoint(addingCheckpoint);
    }
    setAddingCheckpoint(null);
  };

  return (
    <CollapsibleSection
      open={activeOverrideCount > 0}
      title="Scenario overrides"
      description={activeOverrideCount > 0
        ? `${activeOverrideCount} temporary change${activeOverrideCount === 1 ? "" : "s"} active.`
        : `Temporarily add trial accounts, postings, and checkpoints.`}
      badge={activeOverrideCount > 0 ? `${activeOverrideCount} active` : undefined}
    >
      <div className="mt-5 space-y-6">
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onResetAllOverrides} disabled={activeOverrideCount === 0}>
            Reset all overrides
          </Button>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Temporary additions</h3>

          {/* Accounts */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Accounts {whatIfState.addedAccounts.length > 0 ? `(${whatIfState.addedAccounts.length})` : ""}
              </span>
              {!addingAccount ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddingAccount(emptyAccount())}>
                  + Add
                </Button>
              ) : null}
            </div>
            {addingAccount ? (
              <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500">ID</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingAccount.id}
                      onChange={(e) => setAddingAccount({ ...addingAccount, id: e.target.value })}
                      placeholder="e.g. savings"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Label</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingAccount.label}
                      onChange={(e) => setAddingAccount({ ...addingAccount, label: e.target.value })}
                      placeholder="Savings"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500">Color (hex)</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingAccount.color ?? ""}
                      onChange={(e) => setAddingAccount({ ...addingAccount, color: e.target.value || null })}
                      placeholder="#64748b"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={commitAccount}>Add account</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAddingAccount(null)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            {whatIfState.addedAccounts.map((account) => (
              <div key={`tmp-acc-${account.id}`} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: account.color ?? "#eab308" }} />
                  <span className="text-sm font-medium text-amber-900">{account.label}</span>
                  <span className="text-xs text-amber-700">{account.id}</span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveTemporaryAccount(account.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>

          {/* Postings */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Postings {whatIfState.addedPostings.length > 0 ? `(${whatIfState.addedPostings.length})` : ""}
              </span>
              {!addingPosting ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddingPosting(emptyPosting())}>
                  + Add
                </Button>
              ) : null}
            </div>
            {addingPosting ? (
              <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500">ID</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.id}
                      onChange={(e) => setAddingPosting({ ...addingPosting, id: e.target.value })}
                      placeholder="e.g. bonus"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Label</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.label}
                      onChange={(e) => setAddingPosting({ ...addingPosting, label: e.target.value })}
                      placeholder="Bonus"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Source Account</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.sourceAccountId ?? ""}
                      onChange={(e) => setAddingPosting({ ...addingPosting, sourceAccountId: e.target.value || null })}
                      placeholder="Leave blank for external"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Destinations (; separated)</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.destinations?.join(";") ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAddingPosting({ ...addingPosting, destinations: raw.trim() ? raw.split(";").map((s) => s.trim()) : null });
                      }}
                      placeholder="Leave blank for external"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Arithmetic</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.arithmetic}
                      onChange={(e) => setAddingPosting({ ...addingPosting, arithmetic: e.target.value })}
                      placeholder="e.g. 15000"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Frequency</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.frequency}
                      onChange={(e) => setAddingPosting({ ...addingPosting, frequency: e.target.value as Posting["frequency"] })}
                    >
                      <option value="daily">daily</option>
                      <option value="weekly">weekly</option>
                      <option value="monthly">monthly</option>
                      <option value="quarterly">quarterly</option>
                      <option value="annual">annual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Annual Rate</label>
                    <input
                      type="number"
                      step={0.01}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.annualRate}
                      onChange={(e) => setAddingPosting({ ...addingPosting, annualRate: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Annual Growth Rate</label>
                    <input
                      type="number"
                      step={0.01}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.annualGrowthRate}
                      onChange={(e) => setAddingPosting({ ...addingPosting, annualGrowthRate: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Volatility</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.volatility}
                      onChange={(e) => setAddingPosting({ ...addingPosting, volatility: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Start Date</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.startDate}
                      onChange={(e) => setAddingPosting({ ...addingPosting, startDate: e.target.value })}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">End Date</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.endDate ?? ""}
                      onChange={(e) => setAddingPosting({ ...addingPosting, endDate: e.target.value || null })}
                      placeholder="YYYY-MM-DD or blank"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Annual Cap</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.annualCap ?? ""}
                      onChange={(e) => setAddingPosting({ ...addingPosting, annualCap: e.target.value ? Number(e.target.value) : null })}
                      placeholder="Blank for none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Priority</label>
                    <input
                      type="number"
                      min={1}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingPosting.priority}
                      onChange={(e) => setAddingPosting({ ...addingPosting, priority: Math.max(1, Number(e.target.value)) })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={commitPosting}>Add posting</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAddingPosting(null)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            {whatIfState.addedPostings.map((posting) => (
              <div key={`tmp-pst-${posting.id}`} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
                <div>
                  <span className="text-sm font-medium text-amber-900">{posting.label}</span>
                  <span className="ml-2 text-xs text-amber-700">{posting.arithmetic}</span>
                  <span className="ml-2 text-xs text-amber-700">{describeRoute(posting, pack)}</span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveTemporaryPosting(posting.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>

          {/* Checkpoints */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Checkpoints {whatIfState.addedCheckpoints.length > 0 ? `(${whatIfState.addedCheckpoints.length})` : ""}
              </span>
              {!addingCheckpoint ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCheckpoint(emptyCheckpoint())}>
                  + Add
                </Button>
              ) : null}
            </div>
            {addingCheckpoint ? (
              <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500">Date</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingCheckpoint.Date}
                      onChange={(e) => setAddingCheckpoint({ ...addingCheckpoint, Date: e.target.value })}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Account ID</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingCheckpoint.AccountId}
                      onChange={(e) => setAddingCheckpoint({ ...addingCheckpoint, AccountId: e.target.value })}
                      placeholder="e.g. checking"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Balance</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      value={addingCheckpoint.Balance}
                      onChange={(e) => setAddingCheckpoint({ ...addingCheckpoint, Balance: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={commitCheckpoint}>Add checkpoint</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCheckpoint(null)}>Cancel</Button>
                </div>
              </div>
            ) : null}
            {whatIfState.addedCheckpoints.map((checkpoint, index) => (
              <div key={`tmp-chk-${index}`} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
                <div>
                  <span className="text-sm font-medium text-amber-900">{checkpoint.Date}</span>
                  <span className="ml-2 text-xs text-amber-700">{checkpoint.AccountId}</span>
                  <span className="ml-2 text-xs text-amber-700">{currency.format(checkpoint.Balance)}</span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveTemporaryCheckpoint(index)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
