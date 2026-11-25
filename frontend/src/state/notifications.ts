import { getUserScope, subscribeUserScope } from "../auth/resourceScope.ts";
import { toast as toastManager } from "../components/ui/toast.tsx";

export interface ToastAction {
	label: string;
	pendingLabel?: string;
	pendingMessage?: string;
	onAction: () => void | Promise<unknown>;
}

interface ActiveRun {
	token: symbol;
	startGeneration: number;
}

const AUTO_DISMISS_TIMEOUT_MS = 5_000;

const generations = new Map<string, number>();
const active = new Map<string, ActiveRun>();

function generation(key: string): number {
	return generations.get(key) ?? 0;
}

function bumpGeneration(key: string): void {
	generations.set(key, generation(key) + 1);
}

/**
 * Give a clicked action immediate visible feedback and report its outcome on
 * the same key. The generation and scope guards make the last report win:
 * retry sources that publish their own error by the same key are never
 * clobbered by this runner.
 */
async function runToastAction(
	key: string,
	message: string,
	action: ToastAction,
): Promise<void> {
	if (active.has(key)) return;

	const startGeneration = generation(key);
	const scope = getUserScope();
	const token = Symbol(key);
	active.set(key, { token, startGeneration });
	const pendingLabel = action.pendingLabel ?? "Working…";

	toastManager.update(key, (prev) => ({
		type: "loading",
		actionProps: {
			...prev.actionProps,
			children: pendingLabel,
			disabled: true,
			"aria-busy": true,
		},
		...(action.pendingMessage ? { description: action.pendingMessage } : {}),
	}));

	try {
		await action.onAction();
		if (scope !== getUserScope() || generation(key) !== startGeneration) return;
		dismissKey(key);
	} catch (cause) {
		if (scope !== getUserScope() || generation(key) !== startGeneration) return;
		notifyError(
			key,
			cause instanceof Error && cause.message ? cause.message : message,
			action,
		);
	} finally {
		// A scope change may have replaced this run with a newer one on the
		// same key. Only the owner may release the single-flight lock.
		if (active.get(key)?.token === token) active.delete(key);
	}
}

/**
 * Thin domain policy over the shadcn Base UI Toast manager, which owns the
 * single notification system: stacking, manual/swipe dismissal, and
 * announcement urgency. Stable keys upsert in place through the manager id,
 * so repeats replace rather than stack. Identity-scope changes close every
 * toast. Non-action errors and successes auto-dismiss after five seconds.
 * NotificationCenter disables automatic dismissal globally so errors with retry
 * actions remain available until dismissal, recovery, or identity-scope change.
 */
export function notifyError(
	key: string,
	message: string,
	action?: ToastAction,
	onDismiss?: () => void,
): void {
	bumpGeneration(key);
	const publishedGeneration = generation(key);
	toastManager.add({
		id: key,
		type: "error",
		description: message,
		priority: "high",
		timeout: action ? 0 : AUTO_DISMISS_TIMEOUT_MS,
		...(action
			? {
					actionProps: {
						onClick: () => {
							void runToastAction(key, message, action);
						},
						children: action.label,
					},
				}
			: {}),
		onClose: () => {
			// Only clear a run that belongs to this published toast. A newer
			// scope may already own the key and be awaiting its own retry.
			if (active.get(key)?.startGeneration === publishedGeneration)
				active.delete(key);
			bumpGeneration(key);
			onDismiss?.();
		},
	});
}

export function notifySuccess(
	key: string,
	message: string,
	onDismiss?: () => void,
): void {
	bumpGeneration(key);
	toastManager.add({
		id: key,
		type: "success",
		description: message,
		priority: "low",
		timeout: AUTO_DISMISS_TIMEOUT_MS,
		...(onDismiss ? { onClose: onDismiss } : {}),
	});
}

/** Clear every toast for a key, e.g. when its source resolves. */
export function dismissKey(key: string): void {
	bumpGeneration(key);
	toastManager.close(key);
}

/** Toasts describe a verified user's operations; a new resource starts clean. */
subscribeUserScope(() => {
	active.clear();
	toastManager.close();
});
