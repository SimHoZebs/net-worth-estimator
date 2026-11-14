import { subscribeUserScope } from "../auth/resourceScope.ts";
import { toast as toastManager } from "../components/ui/toast.tsx";

export interface ToastAction {
	label: string;
	onAction: () => void;
}

/**
 * Thin domain policy over the shadcn Base UI Toast manager, which owns the
 * single notification system: stacking, manual/swipe dismissal, and
 * announcement urgency. Stable keys upsert in place through the manager id,
 * so repeats replace rather than stack. Identity-scope changes close every
 * toast. NotificationCenter disables automatic dismissal so retry actions
 * remain available until dismissal, recovery, or identity-scope change.
 */
export function notifyError(
	key: string,
	message: string,
	action?: ToastAction,
	onDismiss?: () => void,
): void {
	toastManager.add({
		id: key,
		type: "error",
		description: message,
		priority: "high",
		...(action
			? {
					actionProps: {
						onClick: action.onAction,
						children: action.label,
					},
				}
			: {}),
		...(onDismiss ? { onClose: onDismiss } : {}),
	});
}

export function notifySuccess(
	key: string,
	message: string,
	onDismiss?: () => void,
): void {
	toastManager.add({
		id: key,
		type: "success",
		description: message,
		priority: "low",
		...(onDismiss ? { onClose: onDismiss } : {}),
	});
}

/** Clear every toast for a key, e.g. when its source resolves. */
export function dismissKey(key: string): void {
	toastManager.close(key);
}

/** Toasts describe a verified user's operations; a new resource starts clean. */
subscribeUserScope(() => {
	toastManager.close();
});
