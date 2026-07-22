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
				<div className="mb-4">
					<div className="type-eyebrow text-primary">Base simulation</div>
					<h2 className="mt-1 type-title text-xl">Projection path</h2>
					<p className="mt-1 type-muted">
						Account state and transaction execution before evaluation-specific
						questions are applied.
					</p>
				</div>
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
								: "Distribution across stochastic simulation runs"
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

function Metric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
			<div className="type-label">{label}</div>
			<div className="mt-1 type-metric text-foreground">{value}</div>
			<div className="type-muted">{detail}</div>
		</div>
	);
}
