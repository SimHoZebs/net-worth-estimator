import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-[0_10px_24px_color-mix(in_oklab,var(--primary)_24%,transparent)] hover:bg-primary/90 hover:shadow-[0_12px_28px_color-mix(in_oklab,var(--primary)_30%,transparent)]",
				outline:
					"border-border/80 bg-card/75 text-card-foreground shadow-sm hover:border-ring/70 hover:bg-accent aria-expanded:border-ring/70 aria-expanded:bg-accent dark:border-white/10 dark:bg-card/70",
				secondary:
					"border-border/60 bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 aria-expanded:bg-secondary/80 dark:border-white/10",
				ghost:
					"text-muted-foreground hover:bg-accent/85 hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
				destructive:
					"border-destructive/25 bg-destructive-subtle text-destructive-foreground hover:bg-destructive/10 focus-visible:ring-destructive/20",
				link: "border-none px-0 text-foreground underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2",
				xs: "h-7 rounded-md px-2 type-caption [&_svg:not([class*='size-'])]:size-3",
				sm: "h-8 rounded-md px-3 type-body [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-10 px-5 type-body",
				icon: "size-8",
				"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7 rounded-md",
				"icon-lg": "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
	return (
		<button
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
