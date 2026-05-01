import type { CsvPosting, CsvScenarioPack, CsvScenarioWhatIfState } from "@/lib/projection";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currency } from "@/lib/format";

interface CsvPostingWhatIfControlsProps {
  pack: CsvScenarioPack;
  whatIfState: CsvScenarioWhatIfState;
  activeOverrideCount: number;
  onSetPostingMultiplier: (postingId: string, multiplier: number) => void;
  onClearPostingOverride: (postingId: string) => void;
  onResetAllOverrides: () => void;
}

const multiplierFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function describePosting(posting: CsvPosting) {
  if (posting.amountMode === "fixed") {
    return `Base amount ${currency.format(posting.amount)}`;
  }

  return `${Math.round(posting.amount * 100)}% of ${posting.basePostingId ?? "base posting"}`;
}

function describeRoute(posting: CsvPosting, pack: CsvScenarioPack) {
  const sourceLabel = posting.sourceAccountId
    ? pack.accounts.find((account) => account.id === posting.sourceAccountId)?.label ?? posting.sourceAccountId
    : "External";
  const destinationLabel = posting.destinations
    ? posting.destinations.map((destId) => pack.accounts.find((account) => account.id === destId)?.label ?? destId).join(" ; ")
    : "External";

  return `${sourceLabel} -> ${destinationLabel}`;
}

export function CsvPostingWhatIfControls({
  pack,
  whatIfState,
  activeOverrideCount,
  onSetPostingMultiplier,
  onClearPostingOverride,
  onResetAllOverrides,
}: CsvPostingWhatIfControlsProps) {
  const enabledPostings = pack.postings.filter((posting) => posting.enabled);

  return (
    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>Adjust scheduled postings</CardTitle>
          <CardDescription>
            Test stronger or weaker cash-flow rules without changing the CSV data files. These overrides are temporary to this browser session.
          </CardDescription>
        </div>
        <CardAction>
          <Button type="button" variant="secondary" onClick={onResetAllOverrides} disabled={activeOverrideCount === 0}>
            Reset all overrides
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {activeOverrideCount > 0
            ? `${activeOverrideCount} temporary override${activeOverrideCount === 1 ? " is" : "s are"} affecting the projection below.`
            : "No temporary overrides are active. All postings are running at their CSV-defined levels."}
        </div>

        {enabledPostings.length > 0 ? enabledPostings.map((posting) => {
          const override = whatIfState.postingOverrides[posting.id];
          const multiplier = override?.mode === "multiplier" ? override.value : 1;
          const sliderValue = Math.round(multiplier * 100);

          return (
            <div key={posting.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-medium text-slate-900">{posting.label}</div>
                  <div className="text-sm text-slate-500">
                    Route: {describeRoute(posting, pack)}. Rule: {describePosting(posting)}.
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span>{multiplierFormatter.format(multiplier)}x</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onClearPostingOverride(posting.id)} disabled={override === undefined}>
                    Reset
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={sliderValue}
                  onChange={(event) => onSetPostingMultiplier(posting.id, Number(event.currentTarget.value) / 100)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>0.00x</span>
                  <span>1.00x base</span>
                  <span>2.00x</span>
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
            No enabled postings are available for temporary overrides.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
