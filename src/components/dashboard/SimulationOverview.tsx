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
			<CardContent className="p-4">
				<PageHeader
					stacked
					level="h2"
					title="Projection path"
					titleClassName="mt-1 type-title text-lg"
					className="mb-3"
				/>
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					<Metric
						size="sm"
						label="Current net worth"
						value={currency.format(result.summary.currentNetWorth)}
					/>
					<Metric
						size="sm"
						label="Deterministic final"
						value={currency.format(result.summary.finalNetWorth)}
					/>
					<Metric
						size="sm"
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
								: undefined
						}
					/>
					<Metric
						size="sm"
						label="Projection dates"
						value={String(
							result.timeline.rows.filter((row) => !row.isHistorical).length,
						)}
					/>
				</div>
			</CardContent>
		</Card>
	);
}
