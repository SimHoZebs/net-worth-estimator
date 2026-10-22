import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { mergeStyles } from "./mergeStyles.ts";

import { noticeStyles } from "./noticeStyles.ts";

export function Notice({
	tone,
	className,
	role = tone === "danger" ? "alert" : "note",
	...props
}: ComponentProps<"div"> & VariantProps<typeof noticeStyles>) {
	return (
		<div
			{...props}
			role={role}
			className={mergeStyles(noticeStyles({ tone }), className)}
		/>
	);
}
