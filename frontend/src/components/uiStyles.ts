import { cva } from "class-variance-authority";

export const badgeStyles = cva(
	"inline-flex w-fit items-center gap-1 rounded-control px-2 py-1 text-xs leading-snug font-medium whitespace-nowrap capitalize",
	{
		variants: {
			tone: {
				neutral: "bg-surface-3 text-muted",
				success: "bg-success-bg text-success-text",
				warning: "bg-warning-bg text-warning-text",
				outline:
					"border border-solid border-line-strong bg-transparent text-muted",
			},
		},
		defaultVariants: { tone: "neutral" },
	},
);

export const progressTrackStyles = cva("h-1 overflow-hidden rounded-control", {
	variants: { tone: { success: "bg-line", warning: "bg-warning-bg" } },
	defaultVariants: { tone: "success" },
});

export const progressFillStyles = cva(
	"block h-full w-(--progress-width) rounded-[inherit] transition-[width] duration-350",
	{
		variants: { tone: { success: "bg-primary", warning: "bg-warning-text" } },
		defaultVariants: { tone: "success" },
	},
);
