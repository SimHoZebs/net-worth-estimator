import { AlertCircle, Check, X } from "lucide-react";
import { useNotifications, type Toast } from "../state/notifications.ts";
import { IconButton, TextButton } from "./Button.tsx";
import { mergeStyles } from "./mergeStyles.ts";
import { Alert as ShadcnAlert } from "./ui/alert.tsx";

const toastToneStyles: Record<Toast["kind"], string> = {
	error: "border-danger-border bg-danger-bg text-danger-text",
	success: "border-primary bg-primary text-on-primary",
};

/**
 * Toast card on the shadcn alert primitive. The alert bakes in role="alert",
 * so success toasts pass role="status" explicitly. The legacy tone recipe
 * stays the visual owner (dark-mode-safe application tokens).
 */
function ToastCard({ toast }: { toast: Toast }) {
	const dismiss = useNotifications((state) => state.dismiss);
	const Icon = toast.kind === "error" ? AlertCircle : Check;
	return (
		<ShadcnAlert
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
		</ShadcnAlert>
	);
}

/**
 * Floating bottom-right stack. Mounted once in the workspace layout.
 *
 * A plain fixed element, so what the classes say is what renders: no
 * top-layer promotion, no browser geometry to override the corner. An open
 * native dialog covers it; errors that gate a dialog stay inline inside it.
 */
export function NotificationCenter() {
	const items = useNotifications((state) => state.items);

	if (!items.length) return null;
	return (
		<div className="pointer-events-none fixed right-3 bottom-3 z-(--z-toast) flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3 sm:right-6 sm:bottom-5 xl:right-8 print:hidden">
			{items.map((toast) => (
				<ToastCard key={toast.id} toast={toast} />
			))}
		</div>
	);
}
