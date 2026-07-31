import { formatCurrency } from "@/components/ui/data-table";
import {
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";
import {
	describePostingAmount,
	getExpression,
	type Posting,
} from "@/lib/projection";

export function PostingAmount(
	props: { posting: Posting } | { arithmetic: string },
) {
	const expression =
		"posting" in props ? getExpression(props.posting) : props.arithmetic;
	const description =
		"posting" in props
			? describePostingAmount(props.posting)
			: props.arithmetic;
	return expression !== null && isNumericArithmetic(expression) ? (
		formatCurrency(parseNumericArithmetic(expression))
	) : (
		<div className="flex flex-col gap-0.5">
			<span className="type-code">{description}</span>
			<span className="type-caption">Calculated</span>
		</div>
	);
}
