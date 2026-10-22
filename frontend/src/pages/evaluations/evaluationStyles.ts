import { cva } from "class-variance-authority";

export const evaluationCard = cva(
	"rounded-surface border border-line print:break-inside-avoid",
	{
		variants: {
			enabled: {
				true: "bg-surface",
				false: "bg-surface-2",
			},
		},
		defaultVariants: { enabled: true },
	},
);
