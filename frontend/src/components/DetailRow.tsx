import { cva } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { mergeStyles } from "./mergeStyles.ts";

export const detailListStyles = cva("my-5");
export const detailRowStyles = cva(
	"flex items-center justify-between gap-5 border-b border-line py-3 text-sm [@media(max-width:600px)]:gap-4",
);
export const detailTermStyles = cva("text-muted");
export const detailValueStyles = cva(
	"flex items-center gap-2 text-right text-sm [@media(max-width:600px)]:flex-wrap [@media(max-width:600px)]:justify-end [@media(max-width:600px)]:text-xs",
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
