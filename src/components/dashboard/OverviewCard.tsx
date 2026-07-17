import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticProjectionResult,
} from "@/lib/projection";

interface OverviewCardProps {
	result: ProjectionResult;
	projectionSettings: ProjectionRuntimeSettings;
	stochasticResult?: StochasticProjectionResult | null;
	blockerValue: string;
	blockerDetail: string;
	goalReached: boolean;
}

export const OverviewCard = memo(function OverviewCard({
	result,
	projectionSettings,
	stochasticResult,
	blockerValue,
	blockerDetail,
}: OverviewCardProps) {
	const analysis = result.financialIndependence;
	const firstCoverageDate = analysis.milestones.firstCoverageDate;
	const selfSustainingDate = stochasticResult
		? stochasticResult.milestones.fiSelfSustainingDate
		: analysis.milestones.firstSelfSustainingDate;
	const laborDependentSources =
		projectionSettings.financialIndependencePlan?.sources.filter(
			(source) =>
				source.type === "cashflow" && source.included && source.laborDependent,
		).length ?? 0;
	const displayDate =
		stochasticResult?.milestones.medianFiCoverageDate ?? firstCoverageDate;
	const coverageRow =
		analysis.rows.find((row) => row.date === displayDate) ?? analysis.rows[0];
	const confidence = stochasticResult?.milestones.fiCycleSuccessProbability;

	return (
		<Card className="rounded-[1.8rem] border-primary-border/45 bg-gradient-to-br from-card/96 via-card/90 to-primary-subtle/35">
			<CardContent className="p-5 md:p-6">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">FI coverage</div>
						<div className="mt-1 type-metric text-foreground">
							{coverageRow ? pct.format(coverageRow.coverageRatio) : "0%"}
						</div>
						<div className="type-muted">
							{coverageRow
								? `${currency.format(coverageRow.totalAnnualCapacity)} of ${currency.format(coverageRow.annualExpenseTarget)} per year`
								: "Select at least one FI source"}
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">First coverage date</div>
						<div className="mt-1 type-metric text-foreground">
							{firstCoverageDate
								? formatDate(firstCoverageDate)
								: "Beyond horizon"}
						</div>
						<div className="type-muted">
							Selected capacity first meets annual expenses
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">First self-sustaining date</div>
						<div className="mt-1 type-metric text-primary">
							{selfSustainingDate
								? formatDate(selfSustainingDate)
								: "Not established"}
						</div>
						<div className="type-muted">
							{stochasticResult
								? `Requires ${pct.format(projectionSettings.financialIndependencePlan?.requiredConfidence ?? 1)} confidence`
								: "Deterministic cycle validation"}
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">FI-cycle confidence</div>
						<div className="mt-1 type-metric text-primary">
							{confidence === undefined
								? "Run Monte Carlo"
								: pct.format(confidence)}
						</div>
						<div className="type-muted line-clamp-2">
							{confidence === undefined
								? blockerDetail
								: "Complete runs that fund expenses and satisfy principal policy"}
						</div>
					</div>
				</div>

				<div className="mt-5 grid gap-2 border-t border-border/70 pt-4 type-muted sm:grid-cols-2 xl:grid-cols-4">
					<span>
						Direct income:{" "}
						<b className="type-value">
							{currency.format(coverageRow?.annualDirectIncome ?? 0)}/yr
						</b>
					</span>
					<span>
						Withdrawal capacity:{" "}
						<b className="type-value">
							{currency.format(coverageRow?.annualWithdrawalCapacity ?? 0)}/yr
						</b>
					</span>
					<span>
						Selected assets:{" "}
						<b className="type-value">
							{currency.format(coverageRow?.selectedAssetBalance ?? 0)}
						</b>
					</span>
					<span>
						Main constraint: <b className="type-value">{blockerValue}</b>
					</span>
				</div>
				{laborDependentSources > 0 ? (
					<p className="mt-3 rounded-xl border border-tertiary-border bg-tertiary-subtle px-3 py-2 type-caption text-tertiary-foreground">
						This FI result includes {laborDependentSources} income source
						{laborDependentSources === 1 ? "" : "s"} that require continued
						labor.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
});
