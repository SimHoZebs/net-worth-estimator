import { useEffect, useId } from "react";
import { create } from "zustand";

// React-owned presence for open dialogs. Drawers and native modals register
// while open so the mobile navigation can refuse to stack above them. This
// replaces a global document query: portals and top-layer dialogs live
// outside the opener tree, but every dialog here is a React component, so a
// shared stack is the source of truth. Order matters: only the topmost
// dialog traps focus, so stacked sheets never fight over it.
interface DialogPresenceState {
	stack: Array<string | symbol>;
	push: (id: string | symbol) => void;
	remove: (id: string | symbol) => void;
}

export const useDialogPresenceStore = create<DialogPresenceState>()((set) => ({
	stack: [],
	push: (id) => set((state) => ({ stack: [...state.stack, id] })),
	remove: (id) =>
		set((state) => {
			const index = state.stack.lastIndexOf(id);
			if (index < 0) return state;
			const next = [...state.stack];
			next.splice(index, 1);
			return { stack: next };
		}),
}));

/** Live topmost check. Reads the store at event time, so overlapping
 * sheets never act on a stale render closure. */
export function isTopmostDialog(id: string | symbol | null): boolean {
	if (id === null) return false;
	const stack = useDialogPresenceStore.getState().stack;
	return stack.length > 0 && stack[stack.length - 1] === id;
}

export function useHasOpenDialog(): boolean {
	return useDialogPresenceStore((state) => state.stack.length > 0);
}

/** Registers while active and returns the stable id for topmost checks. */
export function useOpenDialogRegistration(
	active: boolean,
): string | symbol | null {
	const id = useId();
	const push = useDialogPresenceStore((state) => state.push);
	const remove = useDialogPresenceStore((state) => state.remove);
	useEffect(() => {
		if (!active) return;
		push(id);
		return () => {
			remove(id);
		};
	}, [active, id, push, remove]);
	return active ? id : null;
}
