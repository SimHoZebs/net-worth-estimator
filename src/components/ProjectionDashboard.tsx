import { type CSSProperties, memo, type ReactNode, useMemo } from "react";
import {
	buildAccountDiagnosticChartData,
	buildStochasticChartData,
} from "@/chart/chartData";
import { EvaluationResults } from "@/components/evaluations/EvaluationResults";
import { Pill } from "@/components/present/Present";
import {
	estimateMonthlyPayment,
	indexPaymentPostingsByAccountId,
} from "@/lib/debtUtils";
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
import { AccountDiagnosticChart } from "./dashboard/charts/AccountDiagnosticChart";
import { DriverCard } from "./dashboard/DriverCard";
import { HouseholdCycleCard } from "./dashboard/HouseholdCycleCard";
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
	const debtPayoff = useMemo(() => {
		const startingBalanceById = new Map(
			result.accountSummaries.map((summary) => [
				summary.accountId,
				summary.startingBalance,
			]),
		);
		const debts = document.accounts.filter(
			(account) =>
				account.enabled && (startingBalanceById.get(account.id) ?? 0) < 0,
		);
		if (debts.length === 0) return null;
		const payments = indexPaymentPostingsByAccountId(document);
		let latestMonths = 0;
		for (const debt of debts) {
			const principal = Math.abs(startingBalanceById.get(debt.id) ?? 0);
			const monthly = estimateMonthlyPayment(payments.get(debt.id));
			if (monthly <= 0) return null;
			latestMonths = Math.max(latestMonths, Math.ceil(principal / monthly));
		}
		const debtFreeDate = new Date(
			Date.now() + latestMonths * 30 * 24 * 60 * 60 * 1000,
		)
			.toISOString()
			.slice(0, 10);
		return { date: formatDate(debtFreeDate) };
	}, [document, result]);
	const isStale =
		evaluationResultsAreStale || stochasticEvaluationResultsAreStale;
	return (
		<div className="space-y-4">
			<section id="verdict" aria-label="Verdict summary" className="space-y-3">
				<nav
					aria-label="Results sections"
					className="no-print flex flex-wrap items-center gap-2"
				>
					<VerdictLink href="#evaluations">Evaluations</VerdictLink>
					{hasShortfall ? (
						<VerdictLink href="#projected-shortfalls">
							Shortfall {formatDate(derived.firstUnderfulfilledDate ?? "")}
						</VerdictLink>
					) : null}
					<VerdictLink href="#overview">Path</VerdictLink>
					<VerdictLink href="#projection-chart">Chart</VerdictLink>
					<VerdictLink href="#household-cycle">Household</VerdictLink>
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
							Provisional
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
					) : null}
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
				{derived.biggestShortfallPosting ? (
					<DriverCard
						label="Main constraint"
						value={derived.blockerValue}
						detail={derived.blockerDetail}
						tone="tertiary"
					/>
				) : null}
				{!derived.fulfillmentAvailable ||
				!derived.firstProjectedEvent ||
				derived.firstProjectedEvent.unfulfilledAmount > 0 ||
				(derived.firstProjectedEvent.destinationLimitedAmount ?? 0) > 0 ? (
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
				) : null}
				{!derived.fulfillmentAvailable || derived.postingUtilizationRate < 1 ? (
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
				) : null}
			</section>
			{fulfillment && hasShortfall ? (
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
			) : null}

			<section id="overview" className="scroll-mt-4">
				<SimulationOverview
					result={result}
					stochasticResult={stochasticResult}
					stochasticIsProvisional={stochasticIsProvisional}
					debtPayoffDate={debtPayoff?.date ?? null}
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
