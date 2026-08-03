import { formatCurrency } from "@/components/ui/data-table";
import {
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";
import {
	describePostingAmount,
	getAmountPresentation,
	getExpression,
	type Posting,
} from "@/lib/projection";

export function PostingAmount(
	props:
		| { posting: Posting; showDetails?: boolean }
		| { arithmetic: string; showDetails?: never },
) {
	const expression =
		"posting" in props ? getExpression(props.posting) : props.arithmetic;
	const description =
		"posting" in props
			? describePostingAmount(props.posting)
			: props.arithmetic;
	if (expression !== null && isNumericArithmetic(expression)) {
		return formatCurrency(parseNumericArithmetic(expression));
	}
	return (
		<div className="flex flex-col gap-0.5">
			<span className="type-code">{description}</span>
			<span className="type-caption">Calculated</span>
			{"posting" in props && props.showDetails && expression === null ? (
				<PostingCalculationDetails posting={props.posting} />
			) : null}
		</div>
	);
}

export function PostingCalculationDetails({ posting }: { posting: Posting }) {
	if (getExpression(posting) !== null) return null;
	const presentation = getAmountPresentation(posting.amount);
	return (
		<details className="mt-1 min-w-52 text-left">
			<summary className="cursor-pointer select-none type-caption text-muted-foreground hover:text-foreground">
				View calculation
			</summary>
			<div className="mt-2 rounded-xl border border-border/70 bg-surface/70 p-3">
				{presentation.sections.map((section) => (
					<PresentationNode key={section.label} node={section} />
				))}
			</div>
		</details>
	);
}

function PresentationNode({
	node,
	depth = 0,
}: {
	node: ReturnType<typeof getAmountPresentation>["sections"][number];
	depth?: number;
}) {
	return (
		<div
			className={
				depth === 0
					? "mt-2 first:mt-0"
					: "mt-1.5 border-l border-border/70 pl-3"
			}
		>
			<div className="flex min-w-0 items-baseline justify-between gap-3">
				<span className="type-label break-words">{node.label}</span>
				{node.value !== undefined ? (
					<span className="type-code break-all text-right">{node.value}</span>
				) : null}
			</div>
			{node.children?.map((child, index) => (
				<PresentationNode
					key={`${child.label}-${index}`}
					node={child}
					depth={depth + 1}
				/>
			))}
		</div>
	);
}
