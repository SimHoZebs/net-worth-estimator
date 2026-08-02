// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const originalLocalStorage = Object.getOwnPropertyDescriptor(
	window,
	"localStorage",
);

function setLocalStorage(storage: Storage) {
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}

function createStorage(value: string | null) {
	return {
		getItem: vi.fn(() => value),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	} as unknown as Storage;
}

async function loadStore() {
	vi.resetModules();
	return (await import("@/store")).useStore;
}

afterEach(() => {
	if (originalLocalStorage) {
		Object.defineProperty(window, "localStorage", originalLocalStorage);
	}
	document.documentElement.classList.remove("dark");
});

describe("theme storage", () => {
	it.each(["light", "dark", "system"] as const)(
		"initializes from a valid %s theme",
		async (theme) => {
			setLocalStorage(createStorage(theme));

			const store = await loadStore();

			expect(store.getState().theme).toBe(theme);
		},
	);

	it.each([null, "sepia"])(
		"defaults to system for a missing or invalid stored theme",
		async (theme) => {
			setLocalStorage(createStorage(theme));

			const store = await loadStore();

			expect(store.getState().theme).toBe("system");
		},
	);

	it("defaults to system when localStorage cannot be read", async () => {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get() {
				throw new Error("storage unavailable");
			},
		});

		const store = await loadStore();

		expect(store.getState().theme).toBe("system");
	});

	it("persists explicit themes and removes the system override", async () => {
		const storage = createStorage(null);
		setLocalStorage(storage);
		const store = await loadStore();

		store.getState().setTheme("dark");
		expect(storage.setItem).toHaveBeenCalledWith("theme", "dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		store.getState().setTheme("light");
		expect(storage.setItem).toHaveBeenCalledWith("theme", "light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		store.getState().setTheme("system");
		expect(storage.removeItem).toHaveBeenCalledWith("theme");
	});

	it("still applies theme state when localStorage writes throw", async () => {
		const storage = createStorage(null);
		vi.mocked(storage.setItem).mockImplementation(() => {
			throw new Error("storage unavailable");
		});
		vi.mocked(storage.removeItem).mockImplementation(() => {
			throw new Error("storage unavailable");
		});
		setLocalStorage(storage);
		const store = await loadStore();

		expect(() => store.getState().setTheme("dark")).not.toThrow();
		expect(store.getState().theme).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		expect(() => store.getState().setTheme("system")).not.toThrow();
		expect(store.getState().theme).toBe("system");
	});
});
