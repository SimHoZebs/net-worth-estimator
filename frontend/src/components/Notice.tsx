import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { mergeStyles } from "./mergeStyles.ts";

import { noticeStyles } from "./noticeStyles.ts";
import { Alert as ShadcnAlert } from "./ui/alert.tsx";

/**
 * Inline notice on the shadcn alert primitive. The legacy tone recipe stays
 * the visual owner (dark-mode-safe application tokens); the primitive
 * contributes the data slot. Alert bakes in role="alert", so the
 * informational tone passes role="note" explicitly.
 */
export function Notice({
	tone,
	className,
	role = tone === "danger" ? "alert" : "note",
	...props
}: ComponentProps<"div"> & VariantProps<typeof noticeStyles>) {
	return (
		<ShadcnAlert
			{...props}
			role={role}
			variant={tone === "danger" ? "destructive" : "default"}
			className={mergeStyles(noticeStyles({ tone }), className)}
		/>
	);
}
