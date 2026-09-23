import { Metric, PageHeader } from "@/components/present/present";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate } from "@/lib/format";
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
	const projectedRows = result.timeline.rows.filter((row) => !row.isHistorical);
	const firstProjected = projectedRows[0]?.date;
	const lastProjected = projectedRows[projectedRows.length - 1]?.date;
	const percentiles = stochasticResult?.milestones.finalNetWorthPercentiles;
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
						label={`${stochasticIsProvisional ? "Provisional " : ""}Median final (P50)`}
						value={
							percentiles ? currency.format(percentiles.p50) : "Run Monte Carlo"
						}
						detail={
							percentiles
								? "50th percentile across Monte Carlo paths"
								: "Enable Monte Carlo in Settings"
						}
					/>
					<Metric
						size="sm"
						label="P10 · P90 range"
						value={
							percentiles
								? `${currency.format(percentiles.p10)} – ${currency.format(percentiles.p90)}`
								: "Run Monte Carlo"
						}
						detail={
							percentiles
								? "80% of Monte Carlo paths land in this band"
								: "P10 lower bound · P90 upper bound"
						}
					/>
				</div>
				<p className="mt-3 type-caption">
					{projectedRows.length} projected{" "}
					{projectedRows.length === 1 ? "day" : "days"}
					{firstProjected && lastProjected
						? ` · ${formatDate(firstProjected)} to ${formatDate(lastProjected)}`
						: null}
					.
				</p>
			</CardContent>
		</Card>
	);
}
