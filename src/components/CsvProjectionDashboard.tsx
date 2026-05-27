import { memo, useCallback, useMemo, useState } from "react";
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { Collapsible } from "@/components/ui/collapsible-section";
import { LazySection } from "@/components/ui/lazy-section";
import { StatusPill } from "@/components/ui/status-pill";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	StochasticProjectionResult,
} from "@/lib/projection";
import { selectActiveOverrideCount, useStore } from "@/store";
import { CashFlowWaterfall } from "./dashboard/CashFlowWaterfall";
import { AccountDiagnosticChart } from "./dashboard/charts/AccountDiagnosticChart";
import { DebtSummary } from "./dashboard/DebtSummary";
import { DriverCard } from "./dashboard/DriverCard";
import { NetWorthReconciliation } from "./dashboard/NetWorthReconciliation";
import { OverviewCard } from "./dashboard/OverviewCard";
import { ShortfallCalendar } from "./dashboard/ShortfallCalendar";
import { TransactionCompletionTable } from "./dashboard/tables/TransactionCompletionTable";
import { useDashboardDerivedValues } from "./dashboard/useDashboardDerivedValues";

interface ProjectionDashboardProps {
	pack: ScenarioPack;
	result: ProjectionResult;
	projectionSettings: ProjectionRuntimeSettings;
	stochasticResult?: StochasticProjectionResult | null;
}

export const ProjectionDashboard = memo(function ProjectionDashboard({
	pack,
	result,
	projectionSettings,
	stochasticResult,
}: ProjectionDashboardProps) {
	const [isPostingTablesOpen, setIsPostingTablesOpen] = useState(false);
	const hasStochasticData =
		stochasticResult !== undefined && stochasticResult !== null;
	const accountDiagnosticChartData = useMemo(
		() => buildAccountDiagnosticChartData(pack, result, stochasticResult),
		[pack, result, stochasticResult],
	);
	const activeOverrideCount = useStore(selectActiveOverrideCount);
	const derived = useDashboardDerivedValues(result, pack);
	const milestoneDates = useMemo(
		() => ({
			hitTarget: result.milestones.hitTargetDate ?? undefined,
			firstShortfall: derived.firstShortfallRow?.date ?? undefined,
		}),
		[result.milestones.hitTargetDate, derived.firstShortfallRow?.date],
	);
	const scrollToSourceData = useCallback(() => {
		const el = document.getElementById("model-inputs");
		if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
	}, []);

	return (
		<div className="space-y-6">
			<section id="projection-chart">
				<AccountDiagnosticChart
					pack={pack}
					targetNetWorth={projectionSettings.targetNetWorth}
					hasStochasticData={hasStochasticData}
					chartData={accountDiagnosticChartData}
					milestoneDates={milestoneDates}
				/>
			</section>

			<section id="overview">
				<OverviewCard
					result={result}
					projectionSettings={projectionSettings}
					stochasticResult={stochasticResult}
					blockerValue={derived.blockerValue}
					blockerDetail={derived.blockerDetail}
					goalReached={derived.goalReached}
				/>
			</section>

			<section className="flex flex-wrap items-center gap-2">
				<div
					className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${derived.statusBadgeClassName}`}
				>
					{derived.goalReached ? "On track" : "Off track"}
				</div>
				{activeOverrideCount > 0 ? (
					<div className="rounded-full border border-tertiary-border bg-tertiary-subtle px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-tertiary-foreground">
						{activeOverrideCount} temporary override
						{activeOverrideCount === 1 ? "" : "s"}
					</div>
				) : null}
			</section>

			<section id="cash-flow-debt">
				<LazySection>
					<Collapsible defaultOpen={false}>
						<Collapsible.Trigger>
							<div className="flex items-start justify-between gap-4">
								<div className="flex items-start gap-3">
									<Collapsible.Chevron />
									<div>
										<div className="type-title text-base">
											Cash flow, debt, and reconciliation
										</div>
										<div className="type-muted">
											Monthly cash-flow map, debt summary, and current balance
											reconciliation.
										</div>
									</div>
								</div>
								<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
									Show details
								</span>
							</div>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<div className="space-y-5">
								<CashFlowWaterfall pack={pack} />
								<DebtSummary pack={pack} result={result} />
								<NetWorthReconciliation pack={pack} result={result} />
							</div>
						</Collapsible.Content>
					</Collapsible>
				</LazySection>
			</section>

			<section className="grid gap-4 md:grid-cols-3">
				<div className="flex flex-col gap-3">
					<DriverCard
						label="Main constraint"
						value={derived.blockerValue}
						detail={derived.blockerDetail}
						tone={
							derived.biggestShortfallPosting
								? "tertiary"
								: derived.goalReached
									? "primary"
									: "default"
						}
					/>
					<button
						type="button"
						onClick={scrollToSourceData}
						className="no-print w-full rounded-2xl border border-border/80 bg-card/85 px-4 py-3 text-sm font-semibold text-muted-foreground shadow-sm transition hover:border-ring/70 hover:bg-accent hover:text-accent-foreground dark:border-white/10"
					>
						Explore model inputs
					</button>
				</div>
				<DriverCard
					label="Next projected transaction"
					value={
						derived.firstProjectedRow
							? formatDate(derived.firstProjectedRow.date)
							: "No future transactions"
					}
					detail={derived.nextEventDetail}
				/>
				<DriverCard
					label="Planned transaction completion"
					value={pct.format(derived.postingUtilizationRate)}
					detail={
						derived.requestedPostingAmount === 0
							? `No scheduled transactions are requesting future activity across ${derived.enabledPostingCount} transaction${derived.enabledPostingCount === 1 ? "" : "s"}.`
							: `The model applied ${currency.format(derived.realizedPostingAmount)} of ${currency.format(derived.requestedPostingAmount)} in planned transactions.`
					}
					tone={derived.postingUtilizationRate < 1 ? "tertiary" : "primary"}
				/>
			</section>

			<section id="projected-shortfalls">
				<ShortfallCalendar
					rows={result.timeline.rows}
					postings={pack.postings}
					accounts={pack.accounts}
				/>
			</section>

			<Collapsible
				open={isPostingTablesOpen}
				onOpenChange={setIsPostingTablesOpen}
			>
				<Collapsible.Trigger>
					<div className="flex items-start justify-between gap-4">
						<div className="flex items-start gap-3">
							<Collapsible.Chevron />
							<div>
								<div className="type-title text-base">
									Scheduled transactions
								</div>
								<div className="type-muted">Transaction completion rates.</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<StatusPill>
								{isPostingTablesOpen
									? "Close"
									: `${derived.enabledPostingCount} posting${derived.enabledPostingCount === 1 ? "" : "s"}`}
							</StatusPill>
							<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
								{isPostingTablesOpen ? "Hide details" : "Show details"}
							</span>
						</div>
					</div>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div className="grid gap-6">
						<div className="flex flex-wrap items-center gap-4 type-caption">
							<span className="flex items-center gap-1.5">
								<span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />{" "}
								On track
							</span>
							<span className="flex items-center gap-1.5">
								<span className="inline-block h-2.5 w-2.5 rounded-full bg-tertiary" />{" "}
								Needs attention
							</span>
							<span className="flex items-center gap-1.5">
								<span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />{" "}
								Neutral
							</span>
						</div>
						<TransactionCompletionTable
							postingSummaries={result.postingSummaries}
						/>
					</div>
				</Collapsible.Content>
			</Collapsible>
		</div>
	);
});
