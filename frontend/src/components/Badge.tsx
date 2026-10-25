import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { badgeStyles } from "./badgeStyles.ts";
import { mergeStyles } from "./mergeStyles.ts";

export function Badge({
	children,
	tone = "neutral",
	className,
}: {
	children: ReactNode;
	className?: string;
} & VariantProps<typeof badgeStyles>) {
	return (
		<span className={mergeStyles(badgeStyles({ tone }), className)}>
			{children}
		</span>
	);
}
