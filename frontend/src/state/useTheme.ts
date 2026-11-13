import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appJsonStorage, THEME_STORAGE_KEY } from "./persisted.ts";

export type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const DARK_META = "#0f1411";
const LIGHT_META = "#214c3d";

function isPreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

/** Current merge input is the persisted state slice `{ preference }`. */
function sanitizePreference(value: unknown): ThemePreference {
	if (
		typeof value === "object" &&
		value !== null &&
		isPreference((value as Record<string, unknown>).preference)
	)
		return (value as Record<string, unknown>).preference as ThemePreference;
	return "system";
}

type ThemePersisted = { preference: ThemePreference };

interface ThemeState {
	preference: ThemePreference;
	setPreference: (next: ThemePreference) => void;
	cycle: () => void;
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set, get) => ({
			preference: "system",
			setPreference: (next) => {
				if (!isPreference(next)) return;
				if (get().preference === next) return;
				set({ preference: next });
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
			},
		}),
		{
			name: THEME_STORAGE_KEY,
			version: 1,
			storage: appJsonStorage<ThemePersisted>(),
			partialize: (state) => ({ preference: state.preference }),
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

function applyTheme(preference: ThemePreference, resolved: ResolvedTheme) {
	if (typeof document === "undefined") return;
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
	const preference = useThemeStore((state) => state.preference);
	useEffect(() => {
		applyTheme(preference, resolvePreference(preference));
		if (preference !== "system" || typeof window === "undefined") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const update = () =>
			applyTheme(preference, media.matches ? "dark" : "light");
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

	return { preference, setPreference, cycle };
}
