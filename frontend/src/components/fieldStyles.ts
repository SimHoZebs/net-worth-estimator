import { cva, type VariantProps } from "class-variance-authority";

export const fieldStyles = cva("flex min-w-0 flex-col gap-2", {
	variants: {
		wide: { true: "col-span-full", false: "" },
	},
	defaultVariants: { wide: false },
});

export type FieldStyleProps = VariantProps<typeof fieldStyles>;

const framedControl =
	"w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base placeholder:text-subtle";

export const controlStyles = cva(
	"font-normal text-ink disabled:cursor-not-allowed disabled:opacity-60",
	{
		variants: {
			kind: {
				input: [framedControl, "h-11"],
				select: [framedControl, "h-11"],
				textarea: [framedControl, "min-h-[6lh] resize-y"],
				search:
					"h-11 w-32 rounded-none border-0 bg-transparent px-1 py-2 text-sm placeholder:text-subtle min-[601px]:w-50",
			},
		},
		defaultVariants: { kind: "input" },
	},
);

export type ControlStyleProps = VariantProps<typeof controlStyles>;

export const checkboxStyles = cva(
	"m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60",
);
