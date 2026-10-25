import { useEffect, useId } from "react";
import { create } from "zustand";

// React-owned stack of open modals. Drawers and native modals register
// while open so the mobile navigation can refuse to stack above them. This
// replaces a global document query: portals and top-layer modals live
// outside the opener tree, but every modal here is a React component, so a
// shared stack is the source of truth. Order matters: only the topmost
// modal traps focus, so stacked sheets never fight over it.
interface ModalStackState {
	stack: Array<string | symbol>;
	push: (id: string | symbol) => void;
	remove: (id: string | symbol) => void;
}

export const useModalStackStore = create<ModalStackState>()((set) => ({
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
export function isTopmostModal(id: string | symbol | null): boolean {
	if (id === null) return false;
	const stack = useModalStackStore.getState().stack;
	return stack.length > 0 && stack[stack.length - 1] === id;
}

export function useHasOpenModal(): boolean {
	return useModalStackStore((state) => state.stack.length > 0);
}

/** Registers while active and returns the stable id for topmost checks. */
export function useOpenModalRegistration(
	active: boolean,
): string | symbol | null {
	const id = useId();
	const push = useModalStackStore((state) => state.push);
	const remove = useModalStackStore((state) => state.remove);
	useEffect(() => {
		if (!active) return;
		push(id);
		return () => {
			remove(id);
		};
	}, [active, id, push, remove]);
	return active ? id : null;
}
