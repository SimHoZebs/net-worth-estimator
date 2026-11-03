import { useEffect, useSyncExternalStore } from "react";

// Native modal dialogs are the source of truth for modality. React needs
// only one derived fact: whether any modal is open, so the window-level
// navigation swipe does not stack a sheet above a dialog.
let openModals = 0;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function hasOpenModal() {
	return openModals > 0;
}

function serverHasOpenModal() {
	return false;
}

export function useAnyModalOpen(): boolean {
	return useSyncExternalStore(subscribe, hasOpenModal, serverHasOpenModal);
}

/** Registers while this component's modal dialog is open. */
export function useModalRegistration(active: boolean): void {
	useEffect(() => {
		if (!active) return;
		openModals += 1;
		emit();
		return () => {
			openModals -= 1;
			emit();
		};
	}, [active]);
}
