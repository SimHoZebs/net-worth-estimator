import { cva, type VariantProps } from "class-variance-authority";

/** Shared neutral panels and values for financial detail drawers. */
export const inspectionPanelStyles = cva(
	"flex min-w-0 flex-col rounded-surface border border-line bg-surface p-4",
	{
		variants: { density: { standard: "gap-3", compact: "gap-2" } },
		defaultVariants: { density: "standard" },
	},
);

export const inspectionValueStyles = cva("tabular-nums", {
	variants: {
		tone: {
			normal: "text-ink",
			positive: "text-success-text",
			negative: "text-danger-text",
		},
		size: {
			base: "m-0 text-base font-bold [overflow-wrap:anywhere]",
			metric: "text-3xl font-bold tracking-tight",
			hero: "m-0 text-3xl leading-tight font-bold [overflow-wrap:anywhere]",
		},
	},
	defaultVariants: { tone: "normal", size: "base" },
});

export type InspectionValueStyleProps = VariantProps<
	typeof inspectionValueStyles
>;
