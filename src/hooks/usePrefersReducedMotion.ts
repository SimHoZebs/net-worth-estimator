import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
	const query = window.matchMedia("(prefers-reduced-motion: reduce)");
	query.addEventListener("change", callback);
	return () => query.removeEventListener("change", callback);
}

function getSnapshot() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getServerSnapshot() {
	return false;
}

export function usePrefersReducedMotion(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
