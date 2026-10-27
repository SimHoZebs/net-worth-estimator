import type { OtherEvaluationCardProps } from "../../components/evaluationCard.ts";
import { FundingGapsCard } from "../../components/funding/FundingGapsCard.tsx";
import { CycleFulfillmentCard } from "./CycleFulfillmentCard.tsx";
import { FinancialIndependenceCard } from "./FinancialIndependenceCard.tsx";

export function OtherEvaluationCard(props: OtherEvaluationCardProps) {
	switch (props.item.type) {
		case "postingFulfillment":
			return <FundingGapsCard {...props} />;
		case "financialIndependence":
			return <FinancialIndependenceCard item={props.item} pin={props.pin} />;
		case "cycleFulfillment":
			return <CycleFulfillmentCard item={props.item} pin={props.pin} />;
		default: {
			const exhaustive: never = props.item.type;
			throw new Error(`Unknown evaluation type: ${String(exhaustive)}`);
		}
	}
}
