import { cva } from "class-variance-authority";

export const fundingCardTitleStyles = cva(
	"m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]",
	{
		variants: {
			state: {
				gap: "text-warning-text",
				clear: "text-success-text",
				unavailable: "text-muted",
			},
		},
		defaultVariants: { state: "unavailable" },
	},
);
