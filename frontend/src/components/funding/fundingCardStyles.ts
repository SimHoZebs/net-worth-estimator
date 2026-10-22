import { cva, type VariantProps } from "class-variance-authority";

export const fundingCardStyles = cva(
	"relative flex w-full min-w-0 flex-col gap-3 self-start rounded-surface border text-left text-inherit has-[>button:hover]:border-warning-text has-[>button:hover]:shadow-sm max-lg:p-6 print:break-inside-avoid",
	{
		variants: {
			state: {
				gap: "border-warning-border bg-warning-bg px-5 pt-5 pb-4",
				clear: "border-success-border bg-success-bg p-5",
				unavailable: "border-line bg-surface px-5 pt-5 pb-4",
			},
		},
		defaultVariants: { state: "unavailable" },
	},
);

export type FundingCardStyleProps = VariantProps<typeof fundingCardStyles>;

export const fundingCardTitleStyles = cva(
	"m-0 flex items-center gap-2 text-xs font-semibold",
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
