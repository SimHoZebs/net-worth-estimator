import type { ComponentProps } from "react";
import { mergeStyles } from "./mergeStyles.ts";

const cardTones = {
	default: "border-line bg-surface",
	subtle: "border-line bg-surface-2",
	success: "border-success-border bg-success-bg",
	warning: "border-warning-border bg-warning-bg",
} as const;

export type CardTone = keyof typeof cardTones;

/** Shared card container so every card renders at the same size. */
export function Card({
	tone = "default",
	className,
	...props
}: ComponentProps<"section"> & { tone?: CardTone }) {
	return (
		<section
			className={mergeStyles(
				"flex h-full w-full min-w-0 max-w-2xl flex-col gap-4 rounded-surface border p-5 print:break-inside-avoid",
				cardTones[tone],
				className,
			)}
			{...props}
		/>
	);
}
