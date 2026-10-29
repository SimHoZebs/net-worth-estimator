import { cva, type VariantProps } from "class-variance-authority";

export const transactionIconStyles = cva("grid shrink-0 place-items-center", {
	variants: {
		tone: {
			transfer: "bg-surface-3 text-muted",
			inflow: "bg-success-bg text-success-text",
			outflow: "bg-warning-bg text-warning-text",
		},
		size: { row: "size-8 rounded-full", hero: "size-11 rounded-surface" },
	},
	defaultVariants: { tone: "transfer", size: "row" },
});

export type TransactionTone = NonNullable<
	VariantProps<typeof transactionIconStyles>["tone"]
>;

export const transactionRowStyles = cva("hover:bg-surface-2", {
	variants: { dimmed: { true: "bg-surface-2", false: "" } },
});

export const transactionCellStyles = cva("py-3", {
	variants: {
		column: {
			date: "w-[1%] pr-3 pl-0 text-xs whitespace-nowrap text-muted max-sm:hidden",
			name: "w-auto px-3 whitespace-normal max-sm:px-2",
			amount:
				"w-32 pr-1 pl-3 text-right whitespace-nowrap tabular-nums max-sm:w-24 max-sm:pr-0 max-sm:pl-2",
		},
	},
});

export const transactionAmountStyles = cva(
	"m-0 text-sm font-semibold max-sm:text-xs",
	{
		variants: { positive: { true: "text-success-text", false: "" } },
	},
);

export const transactionBadgeStyles = cva("px-1 py-0.5 text-xs");
