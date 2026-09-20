import { Metric, PageHeader } from "@/components/present/present";
import { Card, CardContent } from "@/components/ui/card";
import { currency } from "@/lib/format";
import type {
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";

export function SimulationOverview({
	result,
	stochasticResult,
	stochasticIsProvisional = false,
}: {
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
}) {
	return (
		<Card className="rounded-[1.8rem] border-border/80 bg-gradient-to-br from-card/96 via-card/90 to-surface/70">
			<CardContent className="p-5 md:p-6">
				<PageHeader
					stacked
					level="h2"
					eyebrow="Base simulation"
					title="Projection path"
					titleClassName="mt-1 type-title text-xl"
					description="Account state and transaction execution before evaluation-specific questions are applied."
					descriptionClassName="mt-1 type-muted"
					className="mb-4"
				/>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<Metric
						label="Current net worth"
						value={currency.format(result.summary.currentNetWorth)}
						detail="At the projection boundary"
					/>
					<Metric
						label="Deterministic final"
						value={currency.format(result.summary.finalNetWorth)}
						detail="Base-path ending net worth"
					/>
					<Metric
						label={`${stochasticIsProvisional ? "Provisional " : ""}median final`}
						value={
							stochasticResult
								? currency.format(
										stochasticResult.milestones.finalNetWorthPercentiles.p50,
									)
								: "Run Monte Carlo"
						}
						detail={
							stochasticResult
								? `P10 ${currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p10)} · P90 ${currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p90)}`
								: "Distribution across independent Monte Carlo samples"
						}
					/>
					<Metric
						label="Projection dates"
						value={String(
							result.timeline.rows.filter((row) => !row.isHistorical).length,
						)}
						detail="Dated state transitions in the base path"
					/>
				</div>
			</CardContent>
		</Card>
	);
}
