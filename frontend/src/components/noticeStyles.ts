import { cva } from "class-variance-authority";

export const noticeStyles = cva(
	"flex items-start gap-3 rounded-surface border border-solid p-4 text-xs leading-relaxed",
	{
		variants: {
			tone: {
				info: "border-success-border bg-success-bg text-success-text",
				warning: "border-warning-border bg-warning-bg text-warning-text",
				danger: "border-danger-border bg-danger-bg text-danger-text",
			},
		},
		defaultVariants: { tone: "info" },
	},
);
