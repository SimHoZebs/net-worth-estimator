import { cva, type VariantProps } from "class-variance-authority";

/**
 * Shared card container. Every card reuses this recipe instead of copying
 * its layout so cards keep consistent sizes across pages.
 */
export const cardStyles = cva(
	"flex h-full w-full min-w-0 flex-col gap-4 rounded-surface border p-5 print:break-inside-avoid",
	{
		variants: {
			tone: {
				default: "border-line bg-surface",
				subtle: "border-line bg-surface-2",
				success: "border-success-border bg-success-bg",
				warning: "border-warning-border bg-warning-bg",
			},
		},
		defaultVariants: { tone: "default" },
	},
);

export type CardStyleProps = VariantProps<typeof cardStyles>;
