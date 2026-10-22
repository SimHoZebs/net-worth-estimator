import type { VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import {
	buttonStyles,
	iconButtonStyles,
	textButtonStyles,
} from "./buttonStyles.ts";

export function Button({
	variant,
	size,
	className,
	type = "button",
	...props
}: ComponentProps<"button"> & VariantProps<typeof buttonStyles>) {
	return (
		<button
			{...props}
			type={type}
			className={mergeStyles(buttonStyles({ variant, size }), className)}
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
		<button
			{...props}
			type={type}
			className={mergeStyles(textButtonStyles({ tone }), className)}
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
		<button
			title={label}
			{...props}
			type={type}
			className={mergeStyles(iconButtonStyles({ size }), className)}
			aria-label={label}
		>
			<Icon size={iconSize} aria-hidden="true" />
		</button>
	);
}
