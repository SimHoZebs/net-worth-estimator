import { cva } from "class-variance-authority";

export const outlookMetricStyles = cva(
	"min-h-0 rounded-surface border px-4 pt-3 pb-4 max-xl:px-3 print:break-inside-avoid",
	{
		variants: {
			tone: {
				current: "border-line bg-surface",
				projected: "border-success-border bg-success-bg",
			},
		},
		defaultVariants: { tone: "current" },
	},
);
