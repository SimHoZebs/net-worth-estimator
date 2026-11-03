import { cva } from "class-variance-authority";

export const progressStyles = cva(
	"block h-1 w-full appearance-none overflow-hidden rounded-control",
	{
		variants: {
			tone: {
				success:
					"bg-line [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:rounded-[inherit] [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-350 [&::-moz-progress-bar]:rounded-[inherit] [&::-moz-progress-bar]:bg-primary",
				warning:
					"bg-warning-bg [&::-webkit-progress-bar]:bg-warning-bg [&::-webkit-progress-value]:rounded-[inherit] [&::-webkit-progress-value]:bg-warning-text [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-350 [&::-moz-progress-bar]:rounded-[inherit] [&::-moz-progress-bar]:bg-warning-text",
			},
		},
		defaultVariants: { tone: "success" },
	},
);
