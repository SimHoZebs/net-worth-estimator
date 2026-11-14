import { cva, type VariantProps } from "class-variance-authority";

export const transactionIconStyles = cva("grid shrink-0 place-items-center", {
	variants: {
		tone: {
			transfer: "bg-accent text-muted-foreground",
			inflow: "bg-success-bg text-success-text",
			outflow: "bg-warning-bg text-warning-text",
		},
		size: { row: "size-8 rounded-full", hero: "size-11 rounded-xl" },
	},
	defaultVariants: { tone: "transfer", size: "row" },
});

export type TransactionTone = NonNullable<
	VariantProps<typeof transactionIconStyles>["tone"]
>;

export const transactionRowStyles = cva("hover:bg-muted", {
	variants: {
		dimmed: { true: "bg-muted", false: "" },
		divider: {
			warning: "border-b-2 [border-bottom-style:dashed] border-warning-text",
			danger: "border-b-2 border-danger-text",
		},
	},
});

export const transactionCellStyles = cva("py-3", {
	variants: {
		column: {
			// Fixed-layout widths: the date and amount columns hold their
			// content while the transaction column takes the remainder, so
			// long titles truncate instead of widening the table.
			date: "w-24 pr-3 pl-0 text-xs whitespace-nowrap text-muted-foreground max-sm:hidden",
			name: "w-auto min-w-0 px-5 whitespace-normal max-sm:px-4",
			amount:
				"w-36 pr-1 pl-3 text-right whitespace-nowrap tabular-nums max-sm:w-28 max-sm:pr-0 max-sm:pl-2",
		},
	},
});

export const transactionAmountStyles = cva(
	"text-sm font-semibold max-sm:text-xs",
	{
		variants: { positive: { true: "text-success-text", false: "" } },
	},
);

export const transactionBadgeStyles = cva("px-1 py-0.5 text-xs");

export const transactionShortfallRowStyles = cva(
	"bg-warning-bg border-l-4 border-warning-text hover:bg-warning-bg",
);

export const transactionDividerLabelStyles = cva(
	"block text-xs font-semibold whitespace-normal",
	{
		variants: {
			tone: {
				warning: "text-warning-text",
				danger: "text-danger-text",
			},
		},
	},
);
