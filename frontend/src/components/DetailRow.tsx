import { cva } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { mergeStyles } from "./mergeStyles.ts";

export const detailListStyles = cva("my-5");
export const detailRowStyles = cva(
	"flex items-center justify-between gap-5 border-b border-line py-3 text-sm max-sm:gap-4",
);
export const detailTermStyles = cva("text-muted");
export const detailValueStyles = cva(
	"flex items-center gap-2 text-right text-sm max-sm:flex-wrap max-sm:justify-end max-sm:text-xs",
);

export function DetailList({ className, ...props }: ComponentProps<"dl">) {
	return (
		<dl {...props} className={mergeStyles(detailListStyles(), className)} />
	);
}

export function DetailRow({
	label,
	children,
	className,
	labelClassName,
}: {
	label: ReactNode;
	children: ReactNode;
	className?: string;
	labelClassName?: string;
}) {
	return (
		<div className={detailRowStyles()}>
			<dt className={mergeStyles(detailTermStyles(), labelClassName)}>
				{label}
			</dt>
			<dd className={mergeStyles(detailValueStyles(), className)}>
				{children}
			</dd>
		</div>
	);
}
