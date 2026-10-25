import { cva } from "class-variance-authority";

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
