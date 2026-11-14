import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { badgeStyles } from "./badgeStyles.ts";
import { mergeStyles } from "./mergeStyles.ts";
import { Badge as ShadcnBadge } from "./ui/badge.tsx";

/**
 * Status badge on the shadcn badge primitive. The legacy tone recipe stays
 * the visual owner (dark-mode-safe application tokens); the primitive
 * contributes the data slot. h-auto neutralizes the primitive's fixed height
 * so wrapped labels keep the legacy auto height.
 */
export function Badge({
	children,
	tone = "neutral",
	className,
}: {
	children: ReactNode;
	className?: string;
} & VariantProps<typeof badgeStyles>) {
	return (
		<ShadcnBadge
			variant={
				tone === "neutral"
					? "secondary"
					: tone === "outline"
						? "outline"
						: "default"
			}
			className={mergeStyles(badgeStyles({ tone }), "h-auto", className)}
		>
			{children}
		</ShadcnBadge>
	);
}
