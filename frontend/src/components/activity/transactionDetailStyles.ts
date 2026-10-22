import { cva } from "class-variance-authority";

/** Inline controls keep their read layout and own their native interaction states. */
export const transactionControlStyles = cva(
	"m-0 max-w-full rounded-control border border-transparent bg-transparent px-px py-0 enabled:hover:border-line-strong focus-visible:bg-input-bg focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0",
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
				name: "min-w-0 flex-auto text-xl leading-[1.3] font-semibold tracking-tight text-inherit",
				amount:
					"w-auto min-w-0 flex-auto text-2xl leading-[1.3] font-medium tracking-tight text-inherit tabular-nums",
				date: "min-w-0 text-sm font-medium text-ink",
				account: "text-sm font-semibold text-ink",
			},
			appearance: { plain: "appearance-none", native: "appearance-auto" },
			positive: { true: "text-success-text", false: "" },
		},
		defaultVariants: { element: "input", shape: "inline" },
	},
);
