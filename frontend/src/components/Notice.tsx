import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";
import { Alert as ShadcnAlert } from "@/components/ui/alert.tsx";

const noticeTones = {
	info: "border-success-border bg-success-bg text-success-text",
	warning: "border-warning-border bg-warning-bg text-warning-text",
	danger: "border-danger-border bg-danger-bg text-danger-text",
} as const;

export type NoticeTone = keyof typeof noticeTones;

/**
 * Inline notice on the shadcn alert primitive. The application tone recipe
 * stays the visual owner (dark-mode-safe application tokens); the primitive
 * contributes the data slot. Alert bakes in role="alert", so the
 * informational tone passes role="note" explicitly.
 */
export function Notice({
	tone = "info",
	className,
	role = tone === "danger" ? "alert" : "note",
	...props
}: ComponentProps<"div"> & { tone?: NoticeTone }) {
	return (
		<ShadcnAlert
			{...props}
			role={role}
			variant={tone === "danger" ? "destructive" : "default"}
			className={cn(
				"flex items-start gap-3 rounded-surface border border-solid p-4 text-xs leading-relaxed",
				noticeTones[tone],
				className,
			)}
		/>
	);
}
