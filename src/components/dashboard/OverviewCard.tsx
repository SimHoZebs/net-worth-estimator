import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	StochasticProjectionResult,
} from "@/lib/projection";

interface OverviewCardProps {
	result: ProjectionResult;
	projectionSettings: ProjectionRuntimeSettings;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	pack: ScenarioPack;
	blockerValue: string;
	blockerDetail: string;
	goalReached: boolean;
}

export const OverviewCard = memo(function OverviewCard({
	result,
	projectionSettings,
	stochasticResult,
	stochasticIsProvisional = false,
	pack,
	blockerValue,
	blockerDetail,
}: OverviewCardProps) {
	const analysis = result.financialIndependence;
	const firstCoverageDate = analysis.milestones.firstCoverageDate;
	const selfSustainingDate = analysis.milestones.firstSelfSustainingDate;
	const activePostingIds = new Set(pack.postings.map((posting) => posting.id));
	const laborDependentSources =
		projectionSettings.financialIndependencePlan?.sources.filter(
			(source) =>
				source.type === "cashflow" &&
				source.included &&
				source.laborDependent &&
				activePostingIds.has(source.postingId),
		).length;
	const displayDate = firstCoverageDate;
	const coverageRow =
		analysis.rows.find((row) => row.date === displayDate) ?? analysis.rows[0];
	const confidenceDate = stochasticResult?.milestones.fiSelfSustainingDate;
	const confidence = stochasticResult?.milestones.fiCycleSuccessProbability;
	const qualifyingConfidence =
		stochasticResult?.milestones.fiSelfSustainingProbability;

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
						<div className="type-label">Deterministic first coverage</div>
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
						<div className="type-label">
							Deterministic first self-sustaining
						</div>
						<div className="mt-1 type-metric text-primary">
							{selfSustainingDate
								? formatDate(selfSustainingDate)
								: "Not established"}
						</div>
						<div className="type-muted">
							Requires at least{" "}
							{currency.format(
								projectionSettings.financialIndependencePlan.minimumNetWorth,
							)}{" "}
							net worth before cycle evaluation
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">
							{stochasticIsProvisional ? "Provisional " : ""}
							Confidence-qualified FI date
						</div>
						<div className="mt-1 type-metric text-primary">
							{confidenceDate === undefined
								? "Run Monte Carlo"
								: confidenceDate
									? formatDate(confidenceDate)
									: "Not established"}
						</div>
						<div className="type-muted line-clamp-2">
							{confidence === undefined
								? blockerDetail
								: confidenceDate === null
									? `${pct.format(confidence)} of runs succeeded at some candidate; no date reached ${pct.format(projectionSettings.financialIndependencePlan.requiredConfidence)}`
									: stochasticIsProvisional
										? `${pct.format(qualifyingConfidence ?? 0)} at this date from completed runs; still converging`
										: `${pct.format(qualifyingConfidence ?? 0)} at this date; requires ${pct.format(projectionSettings.financialIndependencePlan.requiredConfidence)}`}
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
