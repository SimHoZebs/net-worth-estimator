import { cva } from "class-variance-authority";

export const evaluationCard = cva(
	"flex h-full w-full min-w-0 flex-col gap-4 rounded-surface border border-line p-5 print:break-inside-avoid",
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
