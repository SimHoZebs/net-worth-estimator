import { useEffect, useState, useSyncExternalStore } from "react";

// React-owned presence for open dialogs. Drawers and native modals register
// while open so the mobile navigation can refuse to stack above them. This
// replaces a global document query: portals and top-layer dialogs live
// outside the opener tree, but every dialog here is a React component, so a
// shared stack is the source of truth. Order matters: only the topmost
// dialog traps focus, so stacked sheets never fight over it.
const stack: Array<string | symbol> = [];
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
	version += 1;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getVersion(): number {
	return version;
}

function removeId(id: string | symbol): void {
	const index = stack.lastIndexOf(id);
	if (index >= 0) stack.splice(index, 1);
}

/** Live topmost check. Reads the stack at event time, so overlapping
 * sheets never act on a stale render closure. */
export function isTopmostDialog(id: string | symbol | null): boolean {
	if (id === null) return false;
	return stack.length > 0 && stack[stack.length - 1] === id;
}

export function useHasOpenDialog(): boolean {
	useSyncExternalStore(subscribe, getVersion, getVersion);
	return stack.length > 0;
}

/** Registers while active and returns the stable id for topmost checks. */
export function useOpenDialogRegistration(
	active: boolean,
): string | symbol | null {
	const [id] = useState<string | symbol>(() => Symbol("dialog"));
	useEffect(() => {
		if (!active) return;
		stack.push(id);
		emit();
		return () => {
			removeId(id);
			emit();
		};
	}, [active, id]);
	return active ? id : null;
}
