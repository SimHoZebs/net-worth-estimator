import { type CSSProperties, memo, type ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import {
	buildAccountDiagnosticChartData,
	buildStochasticChartData,
} from "@/chart/chartData";
import { EvaluationResults } from "@/components/evaluations/EvaluationResults";
import { Pill } from "@/components/present/present";
import { Collapsible } from "@/components/ui/collapsible-section";
import { LazySection } from "@/components/ui/lazy-section";
import { formatDate, pct } from "@/lib/format";
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
import { HouseholdCycleCard } from "./dashboard/HouseholdCycleCard";
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
		() => buildAccountDiagnosticChartData(document, result),
		[document, result],
	);
	const stochasticChartData = useMemo(
		() =>
			stochasticResult
				? buildStochasticChartData(result, stochasticResult)
				: null,
		[result, stochasticResult],
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
	const hasShortfall = derived.biggestShortfallPosting !== null;
	const hasDebt = useMemo(
		() =>
			result.accountSummaries.some(
				(summary) => summary.enabled && summary.startingBalance < 0,
			),
		[result.accountSummaries],
	);
	const isStale =
		evaluationResultsAreStale || stochasticEvaluationResultsAreStale;
	const hasAnomaly = hasShortfall || hasDebt || isStale;
	return (
		<div className="space-y-4">
			<section id="verdict" aria-label="Verdict summary" className="space-y-3">
				<nav
					aria-label="Results sections"
					className="no-print flex flex-wrap items-center gap-2"
				>
					<VerdictLink href="#evaluations">Evaluations</VerdictLink>
					<VerdictLink href="#projected-shortfalls">
						{hasShortfall
							? `Shortfall ${formatDate(derived.firstUnderfulfilledDate ?? "")}`
							: "Shortfalls"}
					</VerdictLink>
					<VerdictLink href="#overview">Path</VerdictLink>
					<VerdictLink href="#projection-chart">Chart</VerdictLink>
					<VerdictLink href="#household-cycle">Household</VerdictLink>
					<VerdictLink href="#cash-flow-debt">Cash flow</VerdictLink>
				</nav>

				<div className="flex flex-wrap items-center gap-2">
					{currentChangeCount > 0 ? (
						<Pill
							tone="tertiary"
							textClassName="text-xs font-medium tracking-[0.16em]"
						>
							{currentChangeCount} unsaved change
							{currentChangeCount === 1 ? "" : "s"}
						</Pill>
					) : null}
					{stochasticIsProvisional ? (
						<Pill
							tone="primary"
							textClassName="text-xs font-medium tracking-[0.16em]"
						>
							Provisional Monte Carlo
						</Pill>
					) : null}
					{isStale ? (
						<Pill
							tone="tertiary"
							textClassName="text-xs font-medium tracking-[0.16em]"
						>
							Showing previous results · updating
						</Pill>
					) : null}
					{hasShortfall && derived.firstUnderfulfilledDate ? (
						<a
							href="#projected-shortfalls"
							className="shrink-0 rounded-full border border-tertiary-border bg-tertiary-subtle px-3 py-1 text-xs font-medium tracking-[0.12em] text-tertiary-foreground uppercase"
						>
							First shortfall {formatDate(derived.firstUnderfulfilledDate)}
						</a>
					) : (
						<a
							href="#projected-shortfalls"
							className="shrink-0 rounded-full border border-border/70 px-3 py-1 text-xs font-medium tracking-[0.12em] uppercase"
						>
							No shortfalls
						</a>
					)}
				</div>
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

			<section
				id="verdict-constraint"
				aria-label="Key drivers"
				className="grid gap-3 md:grid-cols-3"
			>
				<div className="flex flex-col gap-3">
					<DriverCard
						label="Main constraint"
						value={derived.blockerValue}
						detail={derived.blockerDetail}
						tone={derived.biggestShortfallPosting ? "tertiary" : "primary"}
					/>
					<Link
						to="/accounts"
						className="no-print w-full rounded-2xl border border-border/80 bg-card/85 px-4 py-3 text-sm font-semibold text-muted-foreground shadow-sm transition hover:border-ring/70 hover:bg-accent hover:text-accent-foreground dark:border-white/10"
					>
						Explore accounts
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
					tone={
						derived.fulfillmentAvailable && derived.postingUtilizationRate < 1
							? "tertiary"
							: "primary"
					}
				/>
			</section>

			<section
				id="projected-shortfalls"
				style={belowFoldStyle}
				className="scroll-mt-4"
			>
				<ShortfallCalendar
					fulfillment={fulfillment}
					rows={result.timeline.rows}
					postings={document.postings}
					accounts={document.accounts}
				/>
			</section>

			<section id="overview" className="scroll-mt-4">
				<SimulationOverview
					result={result}
					stochasticResult={stochasticResult}
					stochasticIsProvisional={stochasticIsProvisional}
				/>
			</section>

			<section id="projection-chart" className="scroll-mt-4">
				<AccountDiagnosticChart
					document={document}
					hasStochasticData={hasStochasticData}
					stochasticIsProvisional={stochasticIsProvisional}
					chartData={accountDiagnosticChartData}
					stochasticChartData={stochasticChartData}
					milestoneDates={milestoneDates}
				/>
			</section>

			<section
				id="household-cycle"
				style={belowFoldStyle}
				className="scroll-mt-4"
			>
				<HouseholdCycleCard document={document} />
			</section>

			<section
				id="cash-flow-debt"
				style={belowFoldStyle}
				className="scroll-mt-4"
			>
				<LazySection>
					<Collapsible defaultOpen={hasAnomaly} autoOpenWhen={hasAnomaly}>
						<Collapsible.Trigger>
							<Collapsible.Header
								title="Cash flow, debt, and reconciliation"
								trailing={
									hasAnomaly ? (
										<Pill tone="tertiary" size="xs">
											Needs review
										</Pill>
									) : undefined
								}
							/>
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
		</div>
	);
});

const belowFoldStyle: CSSProperties = {
	contentVisibility: "auto",
	containIntrinsicSize: "auto none auto 600px",
};

function VerdictLink({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<a
			href={href}
			className="shrink-0 rounded-full border border-border/70 bg-card/85 px-3 py-1 text-xs font-medium tracking-[0.12em] uppercase transition hover:border-ring/70 hover:bg-accent hover:text-accent-foreground"
		>
			{children}
		</a>
	);
}
