import { cva } from "class-variance-authority";

export const detailModalClassName =
	"scroll-smooth max-sm:fixed max-sm:inset-0 max-sm:m-0 max-sm:h-auto max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0";
export const detailPropertyRowClassName =
	"flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0";
export const detailPropertyLabelClassName =
	"w-36 flex-none text-sm font-semibold text-muted";
export const detailFooterClassName =
	"sticky bottom-0 z-10 -mx-8 -mb-8 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-8 py-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:mx-0 max-sm:mb-0 max-sm:px-5";

/** Inline controls keep their read layout and own their native interaction states. */
export const transactionControlStyles = cva(
	"m-0 max-w-full rounded-control border border-transparent bg-transparent px-px py-0 enabled:hover:border-line-strong focus-visible:bg-input-bg",
	{
		variants: {
			element: {
				input:
					"cursor-text read-only:cursor-default read-only:[&::-webkit-calendar-picker-indicator]:hidden read-only:[&::-webkit-inner-spin-button]:hidden read-only:[&::-webkit-datetime-edit]:p-0",
				select: "cursor-pointer disabled:cursor-default",
			},
			shape: {
				inline: "text-inherit",
				compact: "text-xs text-inherit",
				name: "field-sizing-content w-auto min-w-[8ch] max-w-[48ch] text-xl leading-[1.3] font-semibold tracking-tight text-inherit",
				amount:
					"field-sizing-content w-auto min-w-[4ch] max-w-[14ch] text-2xl leading-[1.3] font-medium tracking-tight text-inherit tabular-nums",
				date: "min-w-0 text-sm font-medium text-ink",
				account: "text-sm font-semibold text-ink",
			},
			appearance: { plain: "appearance-none", native: "appearance-auto" },
			positive: { true: "text-success-text", false: "" },
		},
		defaultVariants: { element: "input", shape: "inline" },
	},
);
