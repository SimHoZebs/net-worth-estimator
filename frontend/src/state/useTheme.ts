import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import {
	appJsonStorage,
	appLocalStorage,
	THEME_STORAGE_KEY,
} from "./persisted.ts";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const DARK_META = "#0f1411";
const LIGHT_META = "#214c3d";

function isPreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

function sanitizePreference(value: unknown): ThemePreference {
	if (isPreference(value)) return value;
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		if (isPreference(record.preference)) return record.preference;
		const state = record.state;
		if (typeof state === "object" && state !== null) {
			const inner = (state as Record<string, unknown>).preference;
			if (isPreference(inner)) return inner;
		}
	}
	return "system";
}

type ThemePersisted = { preference: ThemePreference };

/**
 * Reads both the legacy plain-string format (`dark`) and the persist
 * envelope (`{"state":{"preference":"dark"},"version":1}`) so the inline
 * head script in index.html keeps working across the migration.
 */
function themeStorage(): PersistStorage<ThemePersisted> | undefined {
	const fallback = appJsonStorage<ThemePersisted>();
	return {
		getItem: (name) => {
			let raw: string | null = null;
			try {
				raw = appLocalStorage.getItem(name) as string | null;
			} catch {
				return null;
			}
			if (raw === null) return null;
			if (isPreference(raw)) return { state: { preference: raw }, version: 0 };
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (typeof parsed === "string" && isPreference(parsed)) {
					return { state: { preference: parsed }, version: 0 };
				}
				if (typeof parsed === "object" && parsed !== null) {
					const record = parsed as Record<string, unknown>;
					const state = record.state;
					if (typeof state === "object" && state !== null) {
						const preference = (state as Record<string, unknown>).preference;
						if (isPreference(preference)) {
							return {
								state: { preference },
								version:
									typeof record.version === "number" ? record.version : 0,
							};
						}
					}
					// Tolerate a bare object written by a future hand-edit.
					if (isPreference(record.preference)) {
						return { state: { preference: record.preference }, version: 0 };
					}
				}
			} catch {
				// Fall through to null below.
			}
			return null;
		},
		setItem: (name, value) => {
			if (fallback) fallback.setItem(name, value);
			else {
				try {
					appLocalStorage.setItem(name, JSON.stringify(value));
				} catch {
					// Ignore persistence failures; theme still applies this session.
				}
			}
		},
		removeItem: (name) => {
			if (fallback) fallback.removeItem(name);
			else {
				try {
					appLocalStorage.removeItem(name);
				} catch {
					// Ignore.
				}
			}
		},
	};
}

interface ThemeState {
	preference: ThemePreference;
	setPreference: (next: ThemePreference) => void;
	cycle: () => void;
}

function emitChange(next: ThemePreference) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<ThemePreference>("waypoint-theme-change", {
			detail: next,
		}),
	);
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set, get) => ({
			preference: "system",
			setPreference: (next) => {
				if (!isPreference(next)) return;
				if (get().preference === next) return;
				set({ preference: next });
				emitChange(next);
			},
			cycle: () => {
				const current = get().preference;
				const next: ThemePreference =
					current === "system"
						? "light"
						: current === "light"
							? "dark"
							: "system";
				set({ preference: next });
				emitChange(next);
			},
		}),
		{
			name: THEME_STORAGE_KEY,
			version: 1,
			storage: themeStorage(),
			partialize: (state) => ({ preference: state.preference }),
			migrate: (persisted) => ({
				preference: sanitizePreference(persisted),
			}),
			merge: (persisted, current) => ({
				...current,
				preference: sanitizePreference(persisted),
			}),
		},
	),
);

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
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.dataset.theme = resolved;
	root.style.colorScheme = resolved;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta)
		meta.setAttribute("content", resolved === "dark" ? DARK_META : LIGHT_META);
}

export function getStoredTheme(): ThemePreference {
	return useThemeStore.getState().preference;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
	return resolvePreference(preference);
}

export function useThemeSync() {
	const preference = useThemeStore((state) => state.preference);
	useEffect(() => {
		applyTheme(resolvePreference(preference));
		if (preference !== "system" || typeof window === "undefined") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const update = () => applyTheme(media.matches ? "dark" : "light");
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [preference]);
	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === THEME_STORAGE_KEY)
				void useThemeStore.persist.rehydrate();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);
}

export function useTheme() {
	const preference = useThemeStore((state) => state.preference);
	const setPreference = useThemeStore((state) => state.setPreference);
	const cycle = useThemeStore((state) => state.cycle);
	const resolved = resolvePreference(preference);

	const setStoredPreference = useCallback(
		(next: ThemePreference) => {
			setPreference(next);
		},
		[setPreference],
	);

	return { preference, resolved, setPreference: setStoredPreference, cycle };
}
