import { useEffect, useSyncExternalStore } from "react";
import { appLocalStorage, THEME_STORAGE_KEY } from "./persisted.ts";

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const DARK_META = "#0c0a09";
const LIGHT_META = "#ffffff";

function isPreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

/** The stored format is the plain preference string. Anything else is system. */
function readStored(): ThemePreference {
	try {
		const raw = appLocalStorage.getItem(THEME_STORAGE_KEY);
		if (isPreference(raw)) return raw;
	} catch {
		// Private mode or unavailable storage: fall back to system.
	}
	return "system";
}

let currentPreference: ThemePreference = readStored();
const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) listener();
}

export function getThemePreference(): ThemePreference {
	return currentPreference;
}

export function setThemePreference(next: ThemePreference): void {
	if (!isPreference(next) || currentPreference === next) return;
	currentPreference = next;
	try {
		appLocalStorage.setItem(THEME_STORAGE_KEY, next);
	} catch {
		// Ignore persistence failures; theme still applies this session.
	}
	notify();
}

export function cycleThemePreference(): void {
	setThemePreference(
		currentPreference === "system"
			? "light"
			: currentPreference === "light"
				? "dark"
				: "system",
	);
}

/** Re-read storage, keeping corrupt data safe. Entry point for cross-tab sync and tests. */
export function rehydrateThemeFromStorage(): void {
	const next = readStored();
	if (next === currentPreference) return;
	currentPreference = next;
	notify();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): ThemePreference {
	return currentPreference;
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

function applyTheme(preference: ThemePreference) {
	if (typeof document === "undefined") return;
	/* The `.dark` class is the single source of truth: shadcn `dark:`
	   variants key off it, and tokens.css derives color-scheme from it so
	   light-dark() tokens follow the same resolution. */
	const resolved = resolvePreference(preference);
	document.documentElement.classList.toggle("dark", resolved === "dark");
	const colorScheme = document.getElementById("color-scheme");
	if (colorScheme)
		colorScheme.setAttribute(
			"content",
			preference === "system" ? "light dark" : preference,
		);
	const themeColor = document.getElementById("theme-color");
	if (themeColor)
		themeColor.setAttribute(
			"content",
			resolved === "dark" ? DARK_META : LIGHT_META,
		);
}

export function useThemeSync() {
	const preference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	useEffect(() => {
		applyTheme(preference);
		if (preference !== "system" || typeof window === "undefined") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const update = () => applyTheme(preference);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [preference]);
	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === THEME_STORAGE_KEY) rehydrateThemeFromStorage();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);
}

export function useTheme() {
	const preference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	return {
		preference,
		setPreference: setThemePreference,
		cycle: cycleThemePreference,
	};
}
