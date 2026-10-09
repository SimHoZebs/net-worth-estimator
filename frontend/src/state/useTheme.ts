import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "waypoint-theme";
const DARK_META = "#0f1411";
const LIGHT_META = "#214c3d";

let currentPreference: ThemePreference = readStored();
const listeners = new Set<() => void>();

function readStored(): ThemePreference {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === "light" || value === "dark" || value === "system")
			return value;
	} catch {
		// Private mode or unavailable storage: fall back to system.
	}
	return "system";
}

function resolvePreference(preference: ThemePreference): ResolvedTheme {
	if (preference !== "system") return preference;
	if (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
	)
		return "dark";
	return "light";
}

function applyTheme(resolved: ResolvedTheme) {
	const root = document.documentElement;
	root.dataset.theme = resolved;
	root.style.colorScheme = resolved;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta)
		meta.setAttribute("content", resolved === "dark" ? DARK_META : LIGHT_META);
}

export function getStoredTheme(): ThemePreference {
	return readStored();
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	return resolvePreference(preference);
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): ThemePreference {
	return currentPreference;
}

function setStoredPreference(next: ThemePreference) {
	currentPreference = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// Ignore persistence failures; theme still applies for the session.
	}
	applyTheme(resolvePreference(next));
	for (const listener of listeners) listener();
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent<ThemePreference>("waypoint-theme-change", {
				detail: next,
			}),
		);
	}
}

export function useTheme() {
	const preference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const resolved = resolvePreference(preference);

	useEffect(() => {
		// Re-read storage on mount (inline head script may have set the
		// attribute already) and apply the resolved theme.
		currentPreference = readStored();
		applyTheme(resolvePreference(currentPreference));
	}, []);

	useEffect(() => {
		applyTheme(resolvePreference(preference));
	}, [preference]);

	useEffect(() => {
		if (preference !== "system") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const update = () => applyTheme(media.matches ? "dark" : "light");
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [preference]);

	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key !== STORAGE_KEY) return;
			currentPreference = readStored();
			applyTheme(resolvePreference(currentPreference));
			for (const listener of listeners) listener();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const setPreference = useCallback((next: ThemePreference) => {
		setStoredPreference(next);
	}, []);

	const cycle = useCallback(() => {
		const next: ThemePreference =
			currentPreference === "system"
				? "light"
				: currentPreference === "light"
					? "dark"
					: "system";
		setStoredPreference(next);
	}, []);

	return { preference, resolved, setPreference, cycle };
}
