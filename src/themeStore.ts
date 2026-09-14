import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

function isTheme(value: string | null): value is Theme {
	return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
	if (typeof window === "undefined") return "system";
	try {
		const storedTheme = window.localStorage?.getItem("theme") ?? null;
		return isTheme(storedTheme) ? storedTheme : "system";
	} catch {
		return "system";
	}
}

function resolveTheme(theme: Theme): "light" | "dark" {
	if (theme === "system") {
		if (
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function"
		) {
			return window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
		}
		return "light";
	}
	return theme;
}

function applyThemeToDOM(theme: Theme) {
	if (typeof window === "undefined") return;
	const resolved = resolveTheme(theme);
	document.documentElement.classList.toggle("dark", resolved === "dark");
	try {
		if (theme === "system") {
			window.localStorage?.removeItem("theme");
		} else {
			window.localStorage?.setItem("theme", theme);
		}
	} catch {
		// Storage can be unavailable even when window exists.
	}
}

interface ThemeStore {
	theme: Theme;
	resolvedTheme: "light" | "dark";
	setTheme: (theme: Theme) => void;
	syncSystemTheme: () => void;
}

export const useThemeStore = create<ThemeStore>()((set, get) => {
	const initial = readStoredTheme();
	return {
		theme: initial,
		resolvedTheme: resolveTheme(initial),
		setTheme: (theme) => {
			applyThemeToDOM(theme);
			set({ theme, resolvedTheme: resolveTheme(theme) });
		},
		syncSystemTheme: () => {
			if (get().theme !== "system") return;
			applyThemeToDOM("system");
			set({ resolvedTheme: resolveTheme("system") });
		},
	};
});
