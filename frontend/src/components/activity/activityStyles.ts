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
			// Mobile auto-table sizing: the name cell claims the remainder while
			// the amount shrink-wraps its nowrap content. Desktop keeps the fixed
			// date and amount widths so long titles truncate without widening it.
			date: "w-24 pr-3 pl-0 text-xs whitespace-nowrap text-muted-foreground max-sm:hidden",
			name: "w-auto min-w-0 px-5 whitespace-normal max-sm:w-full max-sm:max-w-0 max-sm:px-0",
			amount:
				"pr-1 pl-3 text-right whitespace-nowrap tabular-nums sm:w-36 max-sm:pr-0 max-sm:pl-2",
		},
	},
});

/**
 * Aligned label/value rows for transaction detail metadata. Both tracks have
 * a zero minimum so a long label wraps and a long value never widens the
 * sheet; the same tracks apply at every breakpoint. The value track carries
 * more of the space so a 16px mobile selection such as "Home
 * improvement" or "Everyday checking" stays legible beside the
 * chevron at 320px. Callers pass this
 * to the existing Field primitive so the label keeps its htmlFor association.
 */
export const transactionDetailFieldStyles =
	"grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2.7fr)] items-start gap-x-3 gap-y-1";

/**
 * Labels and static values share a control-height row. A wrapped label keeps
 * its first line on the first control's centre, and it stays there even when
 * the value column continues below it (the category reset action). Muted
 * medium labels never carry the value's weight or colour.
 */
export const transactionDetailLabelStyles =
	"flex min-h-8 min-w-0 items-start break-words pt-1.5 leading-5 text-sm font-medium text-muted-foreground";

export const transactionDetailValueStyles =
	"flex min-h-8 min-w-0 items-center break-words px-2.5 text-base font-normal text-foreground md:text-sm";

/**
 * Editable controls in these rows use the same mobile 16px type as the static
 * values, so iOS does not zoom on focus and no value jumps in size when it
 * turns into an input. Heights and insets come from the existing primitives.
 */
export const transactionDetailControlStyles = "text-base md:text-sm";

export const transactionDetailRowStackStyles = "flex min-w-0 flex-col gap-3";

export const transactionAmountStyles = cva(
	"text-sm font-semibold max-sm:text-xs",
	{
		variants: { positive: { true: "text-success-text", false: "" } },
	},
);

export const transactionShortfallRowStyles = cva(
	"bg-warning-bg border-l-4 border-warning-text hover:bg-warning-bg",
);
