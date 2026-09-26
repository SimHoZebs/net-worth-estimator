import { AccountList } from "../components/AccountList.tsx";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import type { Account, Plan } from "../domain/model.ts";
import type { Projection, RangeResult } from "../domain/projection.ts";
import { FundingInsight } from "./outlook/FundingInsight.tsx";
import { GoalPreview } from "./outlook/GoalPreview.tsx";
import { OutlookMetrics } from "./outlook/OutlookMetrics.tsx";
import { TimingPreview } from "./outlook/TimingPreview.tsx";

export function Outlook({
	plan,
	projection,
	range,
	ranges,
	setRanges,
	years,
	setYears,
	progress,
	rangeError,
	onEvidence,
	onFailure,
	onAccount,
	onPlan,
	onGoals,
	onGoal,
	onTiming,
	onAssumptions,
}: {
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
	ranges: boolean;
	setRanges: (value: boolean) => void;
	years: number;
	setYears: (value: number) => void;
	progress: number;
	rangeError: string | null;
	onEvidence: () => void;
	onFailure: () => void;
	onAccount: (account: Account) => void;
	onPlan: () => void;
	onGoals: () => void;
	onGoal: (id: string) => void;
	onTiming: () => void;
	onAssumptions: () => void;
}) {
	if (!projection.points.length) return null;
	const goal =
		projection.goals.find((result) => result.current < result.goal.target) ??
		projection.goals[0];
	return (
		<>
			<OutlookMetrics
				plan={plan}
				projection={projection}
				range={range}
				ranges={ranges}
				years={years}
				rangeError={rangeError}
				onEvidence={onEvidence}
				onAssumptions={onAssumptions}
				onEnableRange={() => setRanges(true)}
			/>
			<div className="outlook-main">
				<ProjectionChart
					projection={projection}
					range={range}
					ranges={ranges}
					setRanges={setRanges}
					years={years}
					setYears={setYears}
					progress={progress}
					inflation={plan.assumptions.inflation}
					rangeError={rangeError}
				/>
				<FundingInsight
					failure={projection.firstFailure}
					onFailure={onFailure}
					onPlan={onPlan}
				/>
			</div>
			{ranges && range?.points.at(-1) && (
				<div className="range-disclaimer">
					<span className="legend-line dashed" />
					Dashed line: median. Shaded band: 10th–90th percentiles. Scenarios are
					modeled possibilities, not guarantees.
				</div>
			)}
			<div className="outlook-secondary">
				<GoalPreview
					result={goal ?? null}
					range={range}
					onGoals={onGoals}
					onGoal={onGoal}
				/>
				<TimingPreview
					plan={plan}
					projection={projection}
					onTiming={onTiming}
				/>
			</div>
			<AccountList
				plan={plan}
				projection={projection}
				onAccount={onAccount}
				onAll={onPlan}
			/>
		</>
	);
}
