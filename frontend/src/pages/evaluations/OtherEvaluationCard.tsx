import type { ComponentType } from "react";
import type { OtherEvaluationCardProps } from "@/components/evaluationCard.ts";
import { money, percent } from "@/domain/format.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { FundingGapsCard } from "@/components/funding/FundingGapsCard.tsx";
import { CycleFulfillmentCard } from "@/pages/evaluations/CycleFulfillmentCard.tsx";
import { FinancialIndependenceCard } from "@/pages/evaluations/FinancialIndependenceCard.tsx";

/**
 * Generic numeric result rendered alongside the status badge. Only envelopes
 * that carry a numeric `value` (and optional `bands`) produce output; every
 * other evaluation renders exactly as before. Status semantics never change.
 */
export function EvalValueBands({ item }: { item: OtherEvaluation }) {
	const value = item.value;
	const bands = item.bands;
	if (!value && !bands) return null;
	const unitLabel =
		value?.unit === "currency"
			? "Value"
			: value?.unit === "ratio"
				? "Rate"
				: value?.unit === "count"
					? "Count"
					: "Value";
	const formatted =
		value?.current === null || value?.current === undefined
			? null
			: value.unit === "ratio"
				? percent(value.current)
				: value.unit === "currency"
					? money(value.current)
					: String(value.current);
	const bandText =
		bands && (bands.p10 !== null || bands.p50 !== null || bands.p90 !== null)
			? `p10 ${bands.p10 ?? "—"} · p50 ${bands.p50 ?? "—"} · p90 ${bands.p90 ?? "—"}`
			: null;
	return (
		<p className="m-0 text-xs text-muted">
			{formatted !== null && (
				<span>
					{unitLabel}: <strong className="type-value">{formatted}</strong>
				</span>
			)}
			{formatted !== null && bandText && " · "}
			{bandText && <span>Bands {bandText}</span>}
		</p>
	);
}

/**
 * Presentation-layer renderer registry: one card per server evaluation
 * type. Adding a type means adding an entry here, not another switch.
 */
export const EVAL_CARD_REGISTRY: Record<
	OtherEvaluation["type"],
	ComponentType<OtherEvaluationCardProps>
> = {
	postingFulfillment: FundingGapsCard,
	financialIndependence: (props: OtherEvaluationCardProps) => (
		<FinancialIndependenceCard
			item={props.item}
			pin={props.pin}
			range={props.range?.financialIndependence?.[props.item.id] ?? null}
		/>
	),
	cycleFulfillment: CycleFulfillmentCard,
};

export function OtherEvaluationCard(props: OtherEvaluationCardProps) {
	const Card = EVAL_CARD_REGISTRY[props.item.type];
	return (
		<>
			<Card {...props} />
			<EvalValueBands item={props.item} />
		</>
	);
}
