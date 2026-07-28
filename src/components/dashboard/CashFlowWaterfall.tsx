import { memo } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { currency, formatFrequency } from "@/lib/format";
import {
	categorizePosting,
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";
import type { FinancialModelDocument } from "@/lib/projection";

interface CashFlowWaterfallProps {
	document: FinancialModelDocument;
}

export const CashFlowWaterfall = memo(function CashFlowWaterfall({
	document,
}: CashFlowWaterfallProps) {
	const enabledPostings = document.postings.filter(
		(posting) => posting.enabled && posting.frequency !== "once",
	);

	const items = enabledPostings.map((p) => {
		const { type, category } = categorizePosting(p);
		const isNumeric = isNumericArithmetic(p.arithmetic);
		const amount = isNumeric ? parseNumericArithmetic(p.arithmetic) : null;
		const sign = type === "income" ? 1 : -1;
		const signedAmount = amount !== null ? amount * sign : null;

		return {
			label: p.label,
			category,
			type,
			arithmetic: p.arithmetic,
			frequency: p.frequency,
			amount: signedAmount,
			isNumeric,
		};
	});

	const numericItems = items.filter((i) => i.isNumeric);
	const totalInflow = numericItems
		.filter((i) => i.type === "income")
		.reduce((sum, i) => sum + (i.amount ?? 0), 0);
	const totalOutflow = numericItems
		.filter((i) => i.type !== "income")
		.reduce((sum, i) => sum + Math.abs(i.amount ?? 0), 0);
	const remaining = totalInflow - totalOutflow;

	return (
		<Card className="rounded-[1.6rem] border-border shadow-sm ">
			<CardHeader>
				<div>
					<CardTitle>Monthly cash flow</CardTitle>
					<CardDescription>
						How money moves through the model each month.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Category</TableHead>
							<TableHead>Transaction</TableHead>
							<TableHead>Amount</TableHead>
							<TableHead>Frequency</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.length > 0 ? (
							<>
								{items.map((item, i) => (
									<TableRow key={i}>
										<TableCell className="type-label tracking-wide">
											{item.category}
										</TableCell>
										<TableCell className="type-body text-foreground/80">
											{item.label}
										</TableCell>
										<TableCell className="type-value text-sm">
											{item.isNumeric
												? currency.format(item.amount ?? 0)
												: item.arithmetic}
										</TableCell>
										<TableCell className="type-muted">
											{formatFrequency(item.frequency)}
										</TableCell>
									</TableRow>
								))}
								<TableRow className="border-t-2 border-border">
									<TableCell colSpan={2} className="type-title">
										Remaining cash / investment capacity
									</TableCell>
									<TableCell className="type-title">
										{currency.format(remaining)}
									</TableCell>
									<TableCell />
								</TableRow>
							</>
						) : (
							<TableRow>
								<TableCell
									colSpan={4}
									className="py-6 text-center text-muted-foreground"
								>
									No scheduled transactions are enabled.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				{numericItems.length < items.length ? (
					<div className="mt-3 type-caption text-muted-foreground/70">
						Some transactions use formulas rather than fixed amounts. Exact
						monthly totals depend on account balances and other dynamic values.
					</div>
				) : null}
			</CardContent>
		</Card>
	);
});
