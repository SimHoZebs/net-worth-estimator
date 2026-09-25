import {
	ArrowRight,
	ArrowUpRight,
	CalendarDays,
	Check,
	CircleHelp,
	Flag,
	Leaf,
	ShieldCheck,
	TrendingUp,
	TriangleAlert,
} from "lucide-react";
import { AccountList } from "../components/AccountList.tsx";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { Badge, IconButton, Progress } from "../components/ui.tsx";
import {
	compactMoney,
	dateLabel,
	money,
	percent,
	shiftDate,
	sum,
} from "../domain/format.ts";
import type { Account, Plan } from "../domain/model.ts";
import {
	currentNetWorth,
	type Projection,
	type RangeResult,
} from "../domain/projection.ts";

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
	const current = currentNetWorth({ projection, plan });
	const final = projection.points.at(-1);
	const band = range?.points.at(-1);
	const failure = projection.firstFailure;
	const goal =
		projection.goals.find((g) => g.current < g.goal.target) ??
		projection.goals[0];
	const thirtyDays = shiftDate({ date: plan.startDate, days: 30 });
	const upcoming = projection.movements.filter(
		(movement) => movement.date <= thirtyDays,
	);
	const cashAccounts = plan.accounts.filter(
		(a) => a.enabled && a.kind === "cash",
	);
	const cashIds = new Set(cashAccounts.map((a) => a.id));
	const cash = sum(cashAccounts.map((a) => Math.max(0, a.balance - a.floor)));
	const commitments = sum(
		upcoming
			.filter(
				(m) =>
					m.fromId &&
					cashIds.has(m.fromId) &&
					(!m.toId || !cashIds.has(m.toId)),
			)
			.map((m) => m.requested),
	);
	const nextPay = upcoming.find(
		(m) => !m.fromId && m.toId && cashIds.has(m.toId),
	);
	if (!final) return null;

	return (
		<>
			<div className="metrics-grid">
				<section className="metric metric-current">
					<div className="metric-heading">
						<span>Current net worth</span>
						<IconButton
							icon={CircleHelp}
							label="Inspect current net worth evidence"
							onClick={onEvidence}
						/>
					</div>
					<div className="metric-value">{money(current)}</div>
					<div className="metric-context">
						<span className="status-dot" />
						As of {dateLabel(plan.startDate, true)}
						<span className="subtle-divider" />
						USD
					</div>
				</section>
				<section className="metric metric-destination">
					<div className="metric-heading">
						<span>Base case in {final.date.slice(0, 4)}</span>
						<TrendingUp size={19} />
					</div>
					<div className="metric-value" title={money(final.total)}>
						{compactMoney(final.total)}
						<span className="growth-pill">
							{final.total >= current ? "+" : ""}
							{compactMoney(final.total - current)}
						</span>
					</div>
					<div className="metric-context">
						{years}-year projection · future dollars
					</div>
				</section>
				<section className="metric metric-range">
					<div className="metric-heading">
						<span>
							{ranges
								? "The range of possibility"
								: "Make room for uncertainty"}
						</span>
						<Leaf size={18} />
					</div>
					{ranges ? (
						<>
							<div className="range-value">
								{band
									? `${compactMoney(band.lower)} – ${compactMoney(band.upper)}`
									: rangeError
										? "Range unavailable"
										: "Calculating…"}
							</div>
							<p>
								{band
									? `80% of ${range?.count} scenarios · median ${compactMoney(band.median)}`
									: rangeError
										? "Saved data and the base case are unchanged"
										: "Varying annual investment returns"}
							</p>
							<button
								type="button"
								className="text-button"
								onClick={onAssumptions}
							>
								Explore the assumptions <ArrowUpRight size={15} />
							</button>
						</>
					) : (
						<>
							<p>
								See how different investment returns could change the
								destination.
							</p>
							<button
								type="button"
								className="text-button"
								onClick={() => setRanges(true)}
							>
								Explore a range <ArrowRight size={15} />
							</button>
						</>
					)}
				</section>
			</div>
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
				<aside className={`insight-card ${failure ? "" : "insight-positive"}`}>
					<div className="eyebrow">
						<span className="insight-symbol">
							{failure ? (
								<TriangleAlert size={16} />
							) : (
								<ShieldCheck size={16} />
							)}
						</span>
						{failure ? "Worth a closer look" : "Room to move forward"}
					</div>
					<h2>
						{failure
							? "A future expense needs more room."
							: "Your planned movements are covered."}
					</h2>
					{failure ? (
						<>
							<p>
								<strong>{failure.name}</strong> is only partly funded in{" "}
								{dateLabel(failure.date)}.
							</p>
							<div className="funding-values">
								<div>
									<span>Available</span>
									<strong>{money(failure.realized)}</strong>
								</div>
								<div>
									<span>Planned</span>
									<strong>{money(failure.requested)}</strong>
								</div>
							</div>
							<Progress
								value={(failure.realized / failure.requested) * 100}
								label="Funded portion of first shortfall"
								tone="amber"
							/>
							<div className="shortfall-line">
								<TriangleAlert size={14} />
								<span>
									{money(failure.requested - failure.realized)} shortfall
								</span>
							</div>
							<button
								type="button"
								className="button insight-button"
								onClick={onFailure}
							>
								Inspect this expense <ArrowUpRight size={16} />
							</button>
							<span className="insight-caption">
								First shortfall in the base case
							</span>
						</>
					) : (
						<>
							<p>
								No underfunded movements appear within the selected horizon.
								Investment returns remain uncertain.
							</p>
							<button
								type="button"
								className="button insight-button"
								onClick={onPlan}
							>
								Review planned movements <ArrowUpRight size={16} />
							</button>
							<span className="insight-caption">
								Based on current assumptions
							</span>
						</>
					)}
				</aside>
			</div>
			{ranges && band && (
				<div className="range-disclaimer">
					<span className="legend-line dashed" />
					Dashed line: median. Shaded band: 10th–90th percentiles. Scenarios are
					modeled possibilities, not guarantees.
				</div>
			)}
			<div className="outlook-secondary">
				<section className="goal-preview">
					<div className="section-top">
						<h2>
							<Flag size={18} />A goal on the horizon
						</h2>
						<button type="button" className="text-button" onClick={onGoals}>
							All goals <ArrowUpRight size={16} />
						</button>
					</div>
					{goal ? (
						<>
							<div className="goal-preview-content">
								<div>
									<p>{goal.goal.name}</p>
									<div className="goal-date">
										{goal.current >= goal.goal.target
											? "Already there"
											: goal.firstDate
												? dateLabel(goal.firstDate)
												: "Beyond this horizon"}
									</div>
									<span className="muted">
										{goal.current >= goal.goal.target
											? "Met at the start of this plan"
											: "First reached in the base case"}
									</span>
								</div>
								<div className="goal-glyph" aria-hidden="true">
									<Flag size={30} strokeWidth={1.2} />
								</div>
							</div>
							<div className="progress-label">
								<span>{money(goal.current)} today</span>
								<span>{money(goal.goal.target)} goal</span>
							</div>
							<Progress
								value={(goal.current / goal.goal.target) * 100}
								label={goal.goal.name}
							/>
							<button
								type="button"
								className="goal-evidence-link text-button"
								onClick={() => onGoal(goal.goal.id)}
							>
								{range
									? `${percent(range.goalSuccess[goal.goal.id] ?? 0)} of scenarios reach this goal`
									: "See goal evidence"}{" "}
								<ArrowRight size={14} />
							</button>
						</>
					) : (
						<p className="muted">Add a goal to give your plan a destination.</p>
					)}
				</section>
				<section className="timing-preview">
					<div className="section-top">
						<h2>
							<CalendarDays size={18} />
							The next 30 days
						</h2>
						<Badge tone="outline">Cash timing</Badge>
					</div>
					<div className="timing-figures">
						<div>
							<span>Cash above protected balances</span>
							<strong>{money(cash)}</strong>
						</div>
						<div>
							<span>Planned commitments</span>
							<strong>{money(commitments)}</strong>
						</div>
					</div>
					<div className="timing-replenishment">
						<span className="timing-check">
							<Check size={16} />
						</span>
						<span>
							{nextPay ? (
								<>
									<strong>{money(nextPay.requested)} coming in</strong>
									<span>{dateLabel(nextPay.date, true)} · planned income</span>
								</>
							) : (
								<>
									<strong>No incoming cash scheduled</strong>
									<span>Review your near-term plan</span>
								</>
							)}
						</span>
						<IconButton
							icon={ArrowUpRight}
							label="Inspect next 30 days"
							onClick={onTiming}
						/>
					</div>
				</section>
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
