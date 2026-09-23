import { memo } from "react";
import { SectionCard } from "@/components/present/present";
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
import {
	describePostingAmount,
	type FinancialModelDocument,
	getExpression,
} from "@/lib/projection";

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
		const expression = getExpression(p);
		const isNumeric = expression !== null && isNumericArithmetic(expression);
		const amount = isNumeric ? parseNumericArithmetic(expression) : null;
		const sign = type === "income" ? 1 : -1;
		const signedAmount = amount !== null ? amount * sign : null;

		return {
			label: p.label,
			category,
			type,
			arithmetic: describePostingAmount(p),
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
		<SectionCard
			title="Monthly cash flow"
			className="rounded-[1.6rem] border-border shadow-sm"
		>
			<div className="relative">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="sticky left-0 bg-muted/95 backdrop-blur">
								Category
							</TableHead>
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
										<TableCell className="sticky left-0 bg-card/95 type-label tracking-wide backdrop-blur">
											{item.category}
										</TableCell>
										<TableCell className="type-body whitespace-normal break-words text-foreground/80">
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
									<TableCell
										colSpan={2}
										className="type-title whitespace-normal break-words"
									>
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
									className="py-6 text-center whitespace-normal text-muted-foreground"
								>
									No scheduled transactions are enabled.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				<div
					aria-hidden
					className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
				/>
			</div>
			{numericItems.length < items.length ? (
				<div className="mt-3 type-caption text-muted-foreground/70">
					Some transactions use formulas rather than fixed amounts. Exact
					monthly totals depend on account balances and other dynamic values.
				</div>
			) : null}
		</SectionCard>
	);
});
