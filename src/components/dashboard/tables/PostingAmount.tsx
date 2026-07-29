import { formatCurrency } from "@/components/ui/data-table";
import {
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";

export function PostingAmount({ arithmetic }: { arithmetic: string }) {
	return isNumericArithmetic(arithmetic) ? (
		formatCurrency(parseNumericArithmetic(arithmetic))
	) : (
		<div className="flex flex-col gap-0.5">
			<span className="type-code">{arithmetic}</span>
			<span className="type-caption">Calculated</span>
		</div>
	);
}
