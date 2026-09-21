import { currency, pct } from "@/lib/format";
import type {
	EvaluationInstance,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import { getPostingFulfillmentResult } from "@/lib/projection";
import { Metric } from "./_Metric";

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
			/>
			<Metric
				label="Applied"
				value={currency.format(deterministic.realizedAmount)}
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
						: undefined
				}
			/>
		</div>
	);
}
