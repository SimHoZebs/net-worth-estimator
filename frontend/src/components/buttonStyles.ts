import { cva } from "class-variance-authority";

export const buttonStyles = cva(
	"inline-flex items-center justify-center gap-2 rounded-control border border-solid border-transparent font-semibold transition-[background,box-shadow] duration-150 pointer-coarse:min-h-12 print:hidden",
	{
		variants: {
			variant: {
				primary:
					"border-primary bg-primary text-on-primary shadow-xs enabled:hover:bg-primary-hover enabled:hover:shadow-sm",
				secondary:
					"border-line-strong bg-surface text-ink enabled:hover:bg-hover",
				danger: "bg-danger-solid text-on-danger enabled:hover:brightness-90",
				ghost:
					"bg-transparent text-muted enabled:hover:bg-hover enabled:hover:text-ink",
			},
			size: {
				md: "min-h-10 px-4 py-2 text-sm leading-snug",
				sm: "min-h-9 px-3 py-2 text-xs leading-snug",
			},
		},
		defaultVariants: { variant: "secondary", size: "md" },
	},
);

export const textButtonStyles = cva(
	"inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0.5 text-xs font-semibold enabled:hover:underline enabled:hover:underline-offset-4",
	{
		variants: {
			tone: {
				default: "text-success-text enabled:hover:text-ink",
				danger: "text-danger-text",
			},
		},
		defaultVariants: { tone: "default" },
	},
);

export const iconButtonStyles = cva(
	"inline-grid flex-none place-items-center rounded-control border-0 bg-transparent p-1 text-muted enabled:hover:bg-hover enabled:hover:text-ink pointer-coarse:min-h-12 pointer-coarse:min-w-12",
	{
		variants: {
			size: {
				md: "size-8",
				sm: "size-7",
			},
		},
		defaultVariants: { size: "md" },
	},
);
