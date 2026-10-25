import { create } from "zustand";
import { subscribeResourceScope } from "../auth/resourceScope.ts";

export interface ToastAction {
	label: string;
	onAction: () => void;
}

export interface Toast {
	id: string;
	key: string;
	kind: "error" | "success";
	message: string;
	action?: ToastAction;
	onDismiss?: () => void;
}

interface NotificationsState {
	items: Toast[];
	notify: (input: Omit<Toast, "id">) => string;
	dismiss: (id: string) => void;
	clear: () => void;
}

/** The stack shows a handful of recent toasts; older ones roll off. */
const MAX_TOASTS = 4;

let sequence = 0;

export const useNotifications = create<NotificationsState>()((set) => ({
	items: [],
	notify: (input) => {
		const id = `toast-${(sequence += 1)}`;
		set((state) => ({
			items: [
				{ ...input, id },
				...state.items.filter((item) => item.key !== input.key),
			].slice(0, MAX_TOASTS),
		}));
		return id;
	},
	dismiss: (id) =>
		set((state) => ({
			items: state.items.filter((item) => item.id !== id),
		})),
	clear: () => set({ items: [] }),
}));

/** Toasts describe a verified plan's operations; a new resource starts clean. */
subscribeResourceScope(() => useNotifications.getState().clear());

/** Test hook: restores an empty stack and deterministic ids between cases. */
export function resetNotifications(): void {
	sequence = 0;
	useNotifications.setState({ items: [] });
}

/**
 * Explicit triggers. Call these where a failure or confirmation happens —
 * catch blocks, failed submit branches, store failure paths — instead of
 * watching state. Keys upsert, so repeats replace rather than stack.
 */
export function notifyError(
	key: string,
	message: string,
	action?: ToastAction,
	onDismiss?: () => void,
): string {
	return useNotifications
		.getState()
		.notify({ key, kind: "error", message, action, onDismiss });
}

export function notifySuccess(
	key: string,
	message: string,
	onDismiss?: () => void,
): string {
	return useNotifications
		.getState()
		.notify({ key, kind: "success", message, onDismiss });
}

/** Clear every toast for a key, e.g. when its source resolves. */
export function dismissKey(key: string): void {
	for (const item of useNotifications.getState().items)
		if (item.key === key) useNotifications.getState().dismiss(item.id);
}
