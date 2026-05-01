import type { CsvContributionPlan, CsvScenarioPack, CsvScenarioWhatIfState } from "@/lib/projection";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CsvContributionWhatIfControlsProps {
  pack: CsvScenarioPack;
  whatIfState: CsvScenarioWhatIfState;
  activeOverrideCount: number;
  onSetContributionMultiplier: (contributionPlanId: string, multiplier: number) => void;
  onClearContributionOverride: (contributionPlanId: string) => void;
  onResetAllOverrides: () => void;
}

const multiplierFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function describePlan(plan: CsvContributionPlan) {
  if (plan.calculationMode === "fixed") {
    return `Base amount ${plan.amount}`;
  }

  if (plan.calculationMode === "percent_of_capacity") {
    return `${Math.round(plan.amount * 100)}% of capacity`;
  }

  return `${Math.round(plan.amount * 100)}% of ${plan.baseBudgetItemId ?? "budget item"}`;
}

export function CsvContributionWhatIfControls({
  pack,
  whatIfState,
  activeOverrideCount,
  onSetContributionMultiplier,
  onClearContributionOverride,
  onResetAllOverrides,
}: CsvContributionWhatIfControlsProps) {
  const enabledContributionPlans = pack.contributionPlans.filter((plan) => plan.enabled);

  return (
    <Card className="rounded-[1.8rem] border-slate-200 shadow-sm">
      <CardHeader>
        <div>
          <CardTitle>What-If Contribution Overrides</CardTitle>
          <CardDescription>
            Temporary slider overrides apply only in this browser session. They do not modify the CSV pack.
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
            ? `${activeOverrideCount} temporary override${activeOverrideCount === 1 ? " is" : "s are"} active.`
            : "No temporary overrides are active."}
        </div>

        {enabledContributionPlans.length > 0 ? enabledContributionPlans.map((plan) => {
          const override = whatIfState.contributionPlanOverrides[plan.id];
          const multiplier = override?.mode === "multiplier" ? override.value : 1;
          const sliderValue = Math.round(multiplier * 100);
          const targetLabel = pack.accounts.find((account) => account.id === plan.targetAccountId)?.label ?? plan.targetAccountId;

          return (
            <div key={plan.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-medium text-slate-900">{plan.label}</div>
                  <div className="text-sm text-slate-500">
                    Target: {targetLabel}. Rule: {describePlan(plan)}.
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span>{multiplierFormatter.format(multiplier)}x</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onClearContributionOverride(plan.id)} disabled={override === undefined}>
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
                  onChange={(event) => onSetContributionMultiplier(plan.id, Number(event.currentTarget.value) / 100)}
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
            No enabled contribution plans are available for temporary overrides.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
