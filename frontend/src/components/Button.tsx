import type { VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import { Button as ShadcnButton } from "./ui/button.tsx";
import {
	buttonStyles,
	iconButtonStyles,
	textButtonStyles,
} from "./buttonStyles.ts";

/**
 * Application actions on the shadcn button primitive. The legacy recipes
 * stay the visual owner (dark-mode-safe application tokens); the primitive
 * contributes native behavior, data slots, and focus handling. Nova focus
 * rings stay off so the global :focus-visible owner in typography.css paints
 * the single keyboard indicator.
 */
const focusVisibleStyles =
	"focus-visible:outline-solid focus-visible:ring-0";

export function Button({
	variant,
	size,
	className,
	type = "button",
	...props
}: ComponentProps<"button"> & VariantProps<typeof buttonStyles>) {
	return (
		<ShadcnButton
			{...props}
			type={type}
			variant={
				variant === "primary"
					? "default"
					: variant === "danger"
						? "destructive"
						: (variant ?? "secondary")
			}
			size={size === "sm" ? "sm" : "default"}
			className={mergeStyles(
				buttonStyles({ variant, size }),
				focusVisibleStyles,
				className,
			)}
		/>
	);
}

export function TextButton({
	tone,
	className,
	type = "button",
	...props
}: ComponentProps<"button"> & VariantProps<typeof textButtonStyles>) {
	return (
		<ShadcnButton
			{...props}
			type={type}
			variant="link"
			className={mergeStyles(
				textButtonStyles({ tone }),
				focusVisibleStyles,
				className,
			)}
		/>
	);
}

export function IconButton({
	icon: Icon,
	label,
	size,
	iconSize = 18,
	className,
	type = "button",
	...props
}: Omit<ComponentProps<"button">, "children"> &
	VariantProps<typeof iconButtonStyles> & {
		icon: LucideIcon;
		label: string;
		iconSize?: number;
	}) {
	return (
		<ShadcnButton
			title={label}
			{...props}
			type={type}
			variant="ghost"
			size={size === "sm" ? "icon-sm" : "icon"}
			className={mergeStyles(
				iconButtonStyles({ size }),
				focusVisibleStyles,
				className,
			)}
			aria-label={label}
		>
			<Icon size={iconSize} aria-hidden="true" />
		</ShadcnButton>
	);
}
