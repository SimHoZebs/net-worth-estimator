import { AlertCircle, Check, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Projection } from "../domain/result.ts";
import {
	useNotifications,
	type Toast,
	type ToastAction,
} from "../state/notifications.ts";
import { IconButton, TextButton } from "./Button.tsx";
import { mergeStyles } from "./mergeStyles.ts";
import type { useRemoteProjection } from "../state/useRemoteProjection.ts";

/**
 * Bridge one error or notice value into the floating stack. The toast lives
 * while the message is present; clearing the value removes it. Manual
 * dismissal hides the toast until the message changes or the binder
 * remounts, and optionally clears the source through onDismiss.
 */
export function useToast(
	key: string,
	kind: Toast["kind"],
	message: string | null,
	action?: ToastAction,
	onDismiss?: () => void,
): void {
	const notify = useNotifications((state) => state.notify);
	const latest = useRef({ action, onDismiss });
	useEffect(() => {
		latest.current = { action, onDismiss };
	});
	useEffect(() => {
		if (!message) return;
		const id = notify({
			key,
			kind,
			message,
			action: latest.current.action
				? {
						label: latest.current.action.label,
						onAction: () => latest.current.action?.onAction(),
					}
				: undefined,
			onDismiss: latest.current.onDismiss
				? () => latest.current.onDismiss?.()
				: undefined,
		});
		return () => {
			useNotifications.getState().dismiss(id);
		};
		// Action closures refresh through the ref; only identity changes re-push.
		// oxlint-disable-next-line react/exhaustive-deps
	}, [notify, key, kind, message, action?.label]);
}

export function useErrorToast(
	key: string,
	message: string | null,
	action?: ToastAction,
	onDismiss?: () => void,
): void {
	useToast(key, "error", message, action, onDismiss);
}

export function useSuccessToast(
	key: string,
	message: string | null,
	onDismiss?: () => void,
): void {
	useToast(key, "success", message, undefined, onDismiss);
}

type ProjectionState = Pick<
	ReturnType<typeof useRemoteProjection>,
	| "loading"
	| "base"
	| "baseError"
	| "rangeError"
	| "retryProjection"
	| "retryRange"
>;

/**
 * Shared projection error mapping. Scope prefixes the toast keys per page.
 * Returns the display-ready base projection so callers do not duplicate
 * the load/stale conditions.
 */
export function useProjectionToasts(
	scope: string,
	projection: ProjectionState,
	rangesVisible = false,
): { base: Projection | null } {
	const base = projection.base instanceof Error ? null : projection.base;
	const loadError =
		!projection.loading && !base
			? projection.base instanceof Error
				? projection.base.message
				: projection.baseError
			: null;
	useErrorToast(`${scope}:load`, loadError, {
		label: "Retry calculation",
		onAction: projection.retryProjection,
	});
	useErrorToast(
		`${scope}:stale`,
		projection.baseError && base ? projection.baseError : null,
		{
			label: "Retry calculation",
			onAction: projection.retryProjection,
		},
	);
	useErrorToast(
		`${scope}:range`,
		rangesVisible ? projection.rangeError : null,
		{
			label: "Retry scenario calculation",
			onAction: projection.retryRange,
		},
	);
	return { base };
}

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
