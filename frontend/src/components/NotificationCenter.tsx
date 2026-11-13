import { AlertCircle, Check, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useNotifications, type Toast } from "../state/notifications.ts";
import { IconButton, TextButton } from "./Button.tsx";
import { mergeStyles } from "./mergeStyles.ts";
import { supportsPopover } from "./popoverAnchor.ts";

const toastToneStyles: Record<Toast["kind"], string> = {
	error: "border-danger-border bg-danger-bg text-danger-text",
	success: "border-primary bg-primary text-on-primary",
};

function ToastCard({ toast }: { toast: Toast }) {
	const dismiss = useNotifications((state) => state.dismiss);
	const Icon = toast.kind === "error" ? AlertCircle : Check;
	return (
		<div
			role={toast.kind === "error" ? "alert" : "status"}
			className={mergeStyles(
				"pointer-events-auto flex max-w-lg items-center gap-2 rounded-surface border border-solid py-3 pr-3 pl-4 text-xs shadow-overlay",
				toastToneStyles[toast.kind],
			)}
		>
			<Icon size={17} aria-hidden="true" className="shrink-0" />
			<span className="min-w-0 flex-1 whitespace-pre-line">
				{toast.message}
			</span>
			{toast.action && (
				<TextButton
					tone={toast.kind === "error" ? "danger" : undefined}
					className="shrink-0"
					onClick={toast.action.onAction}
				>
					{toast.action.label}
				</TextButton>
			)}
			<IconButton
				icon={X}
				label="Dismiss notification"
				className={
					toast.kind === "success"
						? "shrink-0 text-on-primary enabled:hover:bg-primary-hover enabled:hover:text-on-primary"
						: "shrink-0"
				}
				onClick={() => {
					toast.onDismiss?.();
					dismiss(toast.id);
				}}
			/>
		</div>
	);
}

/**
 * Floating bottom-right stack. Mounted once in the workspace layout.
 *
 * The stack is a manual popover, so it paints in the top layer above
 * modal dialogs and drawers. A fixed element with a large z-index can
 * never outrank a dialog. The manual popover keeps focus free, so the
 * toast stays non-modal and never blocks the page.
 */
export function NotificationCenter() {
	const items = useNotifications((state) => state.items);
	const stackRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const stack = stackRef.current;
		if (!stack || !supportsPopover()) return;
		if (!items.length) {
			if (
				typeof stack.hidePopover === "function" &&
				stack.matches(":popover-open")
			) {
				stack.hidePopover();
			}
			return;
		}
		if (
			typeof stack.showPopover === "function" &&
			!stack.matches(":popover-open")
		) {
			stack.showPopover();
		}
	}, [items.length]);

	if (!items.length) return null;
	return (
		<div
			ref={stackRef}
			{...(supportsPopover() ? { popover: "manual" as const } : {})}
			className="pointer-events-none fixed top-auto right-3 bottom-3 left-auto z-(--z-toast) m-0 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3 border-0 bg-transparent p-0 sm:right-6 sm:bottom-5 xl:right-8 print:hidden"
		>
			{items.map((toast) => (
				<ToastCard key={toast.id} toast={toast} />
			))}
		</div>
	);
}
