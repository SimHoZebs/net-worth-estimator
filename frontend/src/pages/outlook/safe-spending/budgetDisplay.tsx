import { cssVariables } from "@/components/cssVariables.ts";
import { isIsoDate, monthDay } from "@/domain/format.ts";
import { cn } from "@/lib/utils.ts";
import { amountText } from "./amountText.ts";

export function BudgetAmount({
	value,
	className,
	testId,
	describeShortfall,
	showPlus,
	missingText,
}: {
	value: number | null | undefined;
	className?: string;
	testId?: string;
	describeShortfall?: (amount: string) => string;
	showPlus?: boolean;
	missingText?: string;
}) {
	const negative = value != null && value < 0;
	const magnitude = amountText(negative ? -value : value, missingText);
	return (
		<span
			className={cn("tabular-nums", negative && "text-danger-text", className)}
			data-testid={testId}
		>
			{negative
				? (describeShortfall?.(magnitude) ?? `−${magnitude}`)
				: showPlus && value != null && value > 0
					? `+${magnitude}`
					: magnitude}
		</span>
	);
}

export function BudgetSplit({
	first,
	second,
	testId,
}: {
	first: number | null | undefined;
	second: number | null | undefined;
	testId?: string;
}) {
	const share = firstBudgetShare(first, second);
	if (share === null) return null;
	return (
		<div
			aria-hidden="true"
			className="flex h-2 w-full overflow-hidden rounded-full bg-chart-series-2"
			data-testid={testId}
		>
			<span
				className="w-(--first-share) bg-chart-series-1"
				style={cssVariables({ "--first-share": `${share}%` })}
			/>
		</div>
	);
}

export function BudgetMetric({
	label,
	value,
	testId,
	describeShortfall,
	showPlus,
	missingText,
	segment,
	stacked,
	primary,
}: {
	label: string;
	value: number | null | undefined;
	testId?: string;
	describeShortfall?: (amount: string) => string;
	showPlus?: boolean;
	missingText?: string;
	segment?: "first" | "second";
	stacked?: boolean;
	primary?: boolean;
}) {
	return (
		<div
			className={cn(
				"min-w-0 gap-y-0.5",
				stacked
					? "grid"
					: "flex flex-wrap items-baseline justify-between gap-x-3",
			)}
		>
			<dt className={primary ? "font-medium" : "text-muted-foreground"}>
				{segment && (
					<span
						aria-hidden="true"
						className={cn(
							"me-1.5 inline-block size-2 rounded-full",
							segment === "first" ? "bg-chart-series-1" : "bg-chart-series-2",
						)}
					/>
				)}
				{label}
			</dt>
			<dd
				className={cn(
					"m-0 min-w-0 font-medium [overflow-wrap:anywhere]",
					primary && "text-xl font-semibold",
				)}
			>
				<BudgetAmount
					value={value}
					testId={testId}
					describeShortfall={describeShortfall}
					showPlus={showPlus}
					missingText={missingText}
				/>
			</dd>
		</div>
	);
}

export const firstBudgetShare = (
	first: number | null | undefined,
	second: number | null | undefined,
): number | null =>
	first != null &&
	second != null &&
	first >= 0 &&
	second >= 0 &&
	first + second > 0
		? (first / (first + second)) * 100
		: null;

export function budgetDate(value: string | null | undefined): string | null {
	return value && isIsoDate(value) ? monthDay(value) : null;
}
