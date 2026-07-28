import { currency, pct } from "@/lib/format";
import type {
	EvaluationInstance,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import { getPostingFulfillmentResult } from "@/lib/projection";

export function PostingFulfillmentEvaluation({
	evaluation,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
}: {
	evaluation: EvaluationInstance<unknown>;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
}) {
	const deterministic = getPostingFulfillmentResult(
		result,
		evaluation.instanceId,
	)?.deterministic;
	const probabilistic = getPostingFulfillmentResult(
		stochasticResult,
		evaluation.instanceId,
	)?.probabilistic;
	if (!deterministic) return null;

	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
			<Metric
				label="Requested"
				value={currency.format(deterministic.requestedAmount)}
				detail="Scheduled posting requests"
			/>
			<Metric
				label="Applied"
				value={currency.format(deterministic.realizedAmount)}
				detail="Transferred by the model"
			/>
			<Metric
				label="Destination-limited"
				value={currency.format(deterministic.destinationLimitedAmount)}
				detail={`${pct.format(deterministic.completionRate)} satisfied`}
			/>
			<Metric
				label="Underfulfilled"
				value={currency.format(deterministic.unfulfilledAmount)}
				detail={
					deterministic.firstUnderfulfilledDate
						? `First on ${deterministic.firstUnderfulfilledDate}`
						: "No constrained requests"
				}
			/>
			<Metric
				label={`${stochasticIsProvisional ? "Provisional " : ""}full-fulfillment probability`}
				value={
					probabilistic
						? pct.format(probabilistic.fullFulfillmentProbability)
						: "Run Monte Carlo"
				}
				detail={
					probabilistic
						? `${probabilistic.fulfilledRunCount} of ${probabilistic.runCount} independent Monte Carlo samples`
						: "Across stochastic projection paths"
				}
			/>
		</div>
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
