import { currency, formatDate, pct } from "@/lib/format";
import type {
	EvaluationInstance,
	NetWorthThresholdConfig,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	getNetWorthThresholdResult,
	validateNetWorthThresholdConfig,
} from "@/lib/projection";

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
	let config: NetWorthThresholdConfig;
	try {
		config = validateNetWorthThresholdConfig(evaluation.config);
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
			<div className="mb-2 type-eyebrow">Outcome and analysis</div>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Metric
					label="Target"
					value={currency.format(config.target)}
					detail="Configured evaluation threshold"
				/>
				<Metric
					label="Deterministic outcome"
					value={
						deterministic?.firstReachedDate
							? formatDate(deterministic.firstReachedDate)
							: "Not reached"
					}
					detail="First base-path date at or above the target"
				/>
				<Metric
					label={`${stochasticIsProvisional ? "Provisional " : ""}probability`}
					value={
						probabilistic
							? pct.format(probabilistic.probability)
							: "Run Monte Carlo"
					}
					detail="Share of independent Monte Carlo samples that reached the target"
				/>
				<Metric
					label={`${stochasticIsProvisional ? "Provisional " : ""}median date`}
					value={
						probabilistic?.medianReachedDate
							? formatDate(probabilistic.medianReachedDate)
							: probabilistic
								? "Not reached"
								: "Run Monte Carlo"
					}
					detail={
						probabilistic
							? `P10 ${probabilistic.p10ReachedDate ? formatDate(probabilistic.p10ReachedDate) : "never"} · P90 ${probabilistic.p90ReachedDate ? formatDate(probabilistic.p90ReachedDate) : "never"}`
							: "Reached-date distribution across successful independent Monte Carlo samples"
					}
				/>
			</div>
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
