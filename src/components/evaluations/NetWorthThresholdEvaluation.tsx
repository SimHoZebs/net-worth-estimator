import { formatDate, pct } from "@/lib/format";
import type {
	EvaluationInstance,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	getNetWorthThresholdResult,
	validateNetWorthThresholdConfig,
} from "@/lib/projection";
import { Metric } from "./_Metric";

export function NetWorthThresholdEvaluation({
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
	try {
		validateNetWorthThresholdConfig(evaluation.config);
	} catch {
		return null;
	}
	const deterministic = getNetWorthThresholdResult(
		result,
		evaluation.instanceId,
	)?.deterministic;
	const probabilistic = getNetWorthThresholdResult(
		stochasticResult,
		evaluation.instanceId,
	)?.probabilistic;

	return (
		<div>
			<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
				<Metric
					size="sm"
					label="First reached"
					value={
						deterministic?.firstReachedDate
							? formatDate(deterministic.firstReachedDate)
							: "Not reached"
					}
				/>
				<Metric
					size="sm"
					label={`${stochasticIsProvisional ? "Provisional " : ""}probability`}
					value={probabilistic ? pct.format(probabilistic.probability) : "—"}
				/>
				<Metric
					size="sm"
					label={`${stochasticIsProvisional ? "Provisional " : ""}median date`}
					value={
						probabilistic?.medianReachedDate
							? formatDate(probabilistic.medianReachedDate)
							: probabilistic
								? "Not reached"
								: "—"
					}
					detail={
						probabilistic
							? `P10 ${probabilistic.p10ReachedDate ? formatDate(probabilistic.p10ReachedDate) : "never"} · P90 ${probabilistic.p90ReachedDate ? formatDate(probabilistic.p90ReachedDate) : "never"}`
							: undefined
					}
				/>
			</div>
		</div>
	);
}
