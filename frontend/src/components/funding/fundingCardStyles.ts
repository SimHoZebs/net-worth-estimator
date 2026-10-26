import { cva, type VariantProps } from "class-variance-authority";

export const fundingCardStyles = cva(
	"relative flex h-full w-full min-w-0 flex-col gap-4 rounded-surface border p-5 text-left text-inherit has-[>button:hover]:border-warning-text has-[>button:hover]:shadow-sm print:break-inside-avoid",
	{
		variants: {
			state: {
				gap: "border-warning-border bg-warning-bg",
				clear: "border-success-border bg-success-bg",
				unavailable: "border-line bg-surface",
			},
		},
		defaultVariants: { state: "unavailable" },
	},
);

export type FundingCardStyleProps = VariantProps<typeof fundingCardStyles>;

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
