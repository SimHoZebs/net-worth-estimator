import { AlertCircle, Check, X } from "lucide-react";
import { useNotifications, type Toast } from "../state/notifications.ts";
import { IconButton, TextButton } from "./Button.tsx";
import { mergeStyles } from "./mergeStyles.ts";

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
				"pointer-events-auto flex max-w-lg items-center gap-2 rounded-surface border border-solid py-3 pr-3 pl-4 text-xs shadow-lg",
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
						? "shrink-0 text-on-primary enabled:hover:bg-black/15 enabled:hover:text-on-primary"
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

/** Floating bottom-right stack. Mounted once in the workspace layout. */
export function NotificationCenter() {
	const items = useNotifications((state) => state.items);
	if (!items.length) return null;
	return (
		<>
			{items.map((toast) => (
				<ToastCard key={toast.id} toast={toast} />
			))}
		</>
	);
}
