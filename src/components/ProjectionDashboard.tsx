import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { buildAccountDiagnosticChartData } from "@/chart/chartData";
import { EvaluationResults } from "@/components/evaluations/EvaluationResults";
import { Collapsible } from "@/components/ui/collapsible-section";
import { LazySection } from "@/components/ui/lazy-section";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	FinancialModelDocument,
	ProjectionResult,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID,
	getPostingFulfillmentResult,
} from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import {
	useProjectionArtifacts,
	useProjectionExecution,
	useStochasticProgress,
} from "@/runtime/projectionRuntime";
import { selectCurrentChangeCount, useStore } from "@/store";
import { CashFlowWaterfall } from "./dashboard/CashFlowWaterfall";
import { AccountDiagnosticChart } from "./dashboard/charts/AccountDiagnosticChart";
import { DebtSummary } from "./dashboard/DebtSummary";
import { DriverCard } from "./dashboard/DriverCard";
import { NetWorthReconciliation } from "./dashboard/NetWorthReconciliation";
import { ShortfallCalendar } from "./dashboard/ShortfallCalendar";
import { SimulationOverview } from "./dashboard/SimulationOverview";
import { useDashboardDerivedValues } from "./dashboard/useDashboardDerivedValues";

interface ProjectionDashboardProps {
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	sourceRevision: number;
	evaluationResultsAreStale?: boolean;
	stochasticEvaluationResultsAreStale?: boolean;
	stochasticIsRunning?: boolean;
	stochasticProgress?: StochasticProgress | null;
}

export const ProjectionDashboard = memo(function ProjectionDashboard() {
	const {
		document: canonicalDocument,
		effectiveDocument,
		dataUpdatedAt,
	} = useModelRuntime();
	const {
		result,
		stochasticResult,
		stochasticIsProvisional,
		projectionResultIsStale,
		stochasticResultIsStale,
	} = useProjectionArtifacts();
	const { isStochasticRunning } = useProjectionExecution();
	const stochasticProgress = useStochasticProgress();
	const document = effectiveDocument ?? canonicalDocument;
	if (!document || !result) return null;
	return (
		<ProjectionDashboardContent
			document={document}
			result={result}
			stochasticResult={stochasticResult}
			stochasticIsProvisional={stochasticIsProvisional}
			sourceRevision={dataUpdatedAt}
			evaluationResultsAreStale={projectionResultIsStale}
			stochasticEvaluationResultsAreStale={stochasticResultIsStale}
			stochasticIsRunning={isStochasticRunning}
			stochasticProgress={stochasticProgress}
		/>
	);
});

const ProjectionDashboardContent = memo(function ProjectionDashboardContent({
	document,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
	sourceRevision,
	evaluationResultsAreStale = false,
	stochasticEvaluationResultsAreStale = false,
	stochasticIsRunning = false,
	stochasticProgress = null,
}: ProjectionDashboardProps) {
	const hasStochasticData =
		stochasticResult !== undefined && stochasticResult !== null;
	const accountDiagnosticChartData = useMemo(
		() => buildAccountDiagnosticChartData(document, result, stochasticResult),
		[document, result, stochasticResult],
	);
	const currentChangeCount = useStore(selectCurrentChangeCount);
	const fulfillment =
		getPostingFulfillmentResult(result, DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID)
			?.deterministic ?? null;
	const derived = useDashboardDerivedValues(document, fulfillment);
	const milestoneDates = useMemo(
		() => ({
			firstShortfall: derived.firstUnderfulfilledDate ?? undefined,
		}),
		[derived.firstUnderfulfilledDate],
	);
	return (
		<div className="space-y-6">
			<section id="projection-chart">
				<AccountDiagnosticChart
					document={document}
					hasStochasticData={hasStochasticData}
					stochasticIsProvisional={stochasticIsProvisional}
					chartData={accountDiagnosticChartData}
					milestoneDates={milestoneDates}
				/>
			</section>

			<section id="overview">
				<SimulationOverview
					result={result}
					stochasticResult={stochasticResult}
					stochasticIsProvisional={stochasticIsProvisional}
				/>
			</section>

			<section className="flex flex-wrap items-center gap-2">
				<div className="rounded-full border border-primary-border bg-primary-subtle px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-primary">
					Base simulation ready
				</div>
				{currentChangeCount > 0 ? (
					<div className="rounded-full border border-tertiary-border bg-tertiary-subtle px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-tertiary-foreground">
						{currentChangeCount} temporary change
						{currentChangeCount === 1 ? "" : "s"}
					</div>
				) : null}
				{stochasticIsProvisional ? (
					<div className="rounded-full border border-primary-border bg-primary-subtle px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-primary">
						Provisional Monte Carlo
					</div>
				) : null}
			</section>

			<EvaluationResults
				document={document}
				result={result}
				stochasticResult={
					stochasticEvaluationResultsAreStale ? null : stochasticResult
				}
				stochasticIsProvisional={stochasticIsProvisional}
				sourceRevision={sourceRevision}
				resultsAreStale={evaluationResultsAreStale}
				stochasticIsRunning={stochasticIsRunning}
				stochasticProgress={stochasticProgress}
				blockerValue={derived.blockerValue}
				blockerDetail={derived.blockerDetail}
			/>

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
								<CashFlowWaterfall document={document} />
								<DebtSummary document={document} result={result} />
								<NetWorthReconciliation document={document} result={result} />
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
						tone={derived.biggestShortfallPosting ? "tertiary" : "primary"}
					/>
					<Link
						to="/model-inputs"
						className="no-print w-full rounded-2xl border border-border/80 bg-card/85 px-4 py-3 text-sm font-semibold text-muted-foreground shadow-sm transition hover:border-ring/70 hover:bg-accent hover:text-accent-foreground dark:border-white/10"
					>
						Explore model inputs
					</Link>
				</div>
				<DriverCard
					label="Next projected transaction"
					value={
						!derived.fulfillmentAvailable
							? "Unavailable"
							: derived.firstProjectedEvent
								? formatDate(derived.firstProjectedEvent.date)
								: "No future transactions"
					}
					detail={derived.nextEventDetail}
				/>
				<DriverCard
					label="Planned transaction completion"
					value={
						derived.fulfillmentAvailable
							? pct.format(derived.postingUtilizationRate)
							: "Unavailable"
					}
					detail={
						!derived.fulfillmentAvailable
							? "Enable a healthy posting-fulfillment evaluation to inspect completion."
							: derived.requestedPostingAmount === 0
								? `No scheduled transactions are requesting future activity across ${derived.enabledPostingCount} transaction${derived.enabledPostingCount === 1 ? "" : "s"}.`
								: `The model applied ${currency.format(derived.realizedPostingAmount)} of ${currency.format(derived.requestedPostingAmount)} in planned transactions${derived.destinationLimitedPostingAmount > 0 ? `; ${currency.format(derived.destinationLimitedPostingAmount)} was no longer applicable after destinations reached their limits.` : "."}`
					}
					tone={
						derived.fulfillmentAvailable && derived.postingUtilizationRate < 1
							? "tertiary"
							: "primary"
					}
				/>
			</section>

			<section id="projected-shortfalls">
				<ShortfallCalendar
					fulfillment={fulfillment}
					rows={result.timeline.rows}
					postings={document.postings}
					accounts={document.accounts}
				/>
			</section>
		</div>
	);
});
