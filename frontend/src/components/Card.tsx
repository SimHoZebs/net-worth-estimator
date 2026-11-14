import type { ComponentProps } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import { Card as ShadcnCard } from "./ui/card.tsx";

const cardTones = {
	default: "border-line bg-surface",
	subtle: "border-line bg-surface-2",
	success: "border-success-border bg-success-bg",
	warning: "border-warning-border bg-warning-bg",
} as const;

export type CardTone = keyof typeof cardTones;

export const cardHeadingStyles =
	"m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]";

/**
 * Shared card container on the shadcn card primitive. The legacy tone and
 * layout recipe stays the visual owner (dark-mode-safe application tokens);
 * text-ink, text-base, ring-0, and overflow-visible neutralize the
 * primitive's static card tokens, smaller base size, hairline ring, and
 * clipping. A named card keeps the region landmark the previous section
 * element provided.
 */
export function Card({
	tone = "default",
	className,
	role,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledby,
	...props
}: ComponentProps<"div"> & { tone?: CardTone }) {
	return (
		<ShadcnCard
			role={role ?? (ariaLabel ?? ariaLabelledby ? "region" : undefined)}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledby}
			className={mergeStyles(
				"flex h-full w-full min-w-0 max-w-2xl flex-col gap-4 rounded-surface border p-5 text-base text-ink ring-0 print:break-inside-avoid",
				cardTones[tone],
				"overflow-visible",
				className,
			)}
			{...props}
		/>
	);
}
