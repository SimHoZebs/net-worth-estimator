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
			rich: {
				true: "supports-[appearance:base-select]:[appearance:base-select] supports-[appearance:base-select]:[&::picker(select)]:[appearance:base-select] [&::picker(select)]:rounded-control [&::picker(select)]:border [&::picker(select)]:border-line-strong [&::picker(select)]:bg-surface [&::picker(select)]:p-1 [&::picker(select)]:text-ink [&_option]:flex [&_option]:items-center [&_option]:gap-3 [&_option]:rounded-control [&_option]:p-2 [&_option:checked]:bg-surface-3 [&_option:checked]:font-semibold [&_option:hover]:bg-surface-3 [&_selectedcontent]:flex [&_selectedcontent]:items-center [&_selectedcontent]:gap-3",
			},
			kind: {
				input: [framedControl, "h-11"],
				select: [framedControl, "h-11"],
				textarea: [framedControl, "min-h-[6lh] resize-y"],
				search:
					"h-11 w-32 rounded-none border-0 bg-transparent px-1 py-2 text-sm placeholder:text-subtle sm:w-48",
			},
		},
		defaultVariants: { kind: "input" },
	},
);

export type ControlStyleProps = VariantProps<typeof controlStyles>;

export const checkboxStyles = cva(
	"m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60",
);
