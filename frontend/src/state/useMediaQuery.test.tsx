import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery.ts";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("reads browser matches directly and owns one subscription until the query changes", () => {
	let matches = false;
	const listeners = new Set<() => void>();
	const remove = vi.fn((_: string, listener: () => void) =>
		listeners.delete(listener),
	);
	const media = {
		get matches() {
			return matches;
		},
		addEventListener: vi.fn((_: string, listener: () => void) =>
			listeners.add(listener),
		),
		removeEventListener: remove,
	};
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => Object.create(media)),
	);
	const onChange = vi.fn();
	const view = renderHook(({ query }) => useMediaQuery(query, onChange), {
		initialProps: { query: "(width < 48rem)" },
	});
	expect(view.result.current).toBe(false);
	expect(onChange).not.toHaveBeenCalled();
	act(() => {
		matches = true;
		for (const listener of listeners) listener();
	});
	expect(view.result.current).toBe(true);
	expect(onChange).toHaveBeenCalledWith(true);
	view.rerender({ query: "(width < 40rem)" });
	expect(remove).toHaveBeenCalledTimes(1);
	expect(listeners.size).toBe(1);
	view.unmount();
	expect(listeners.size).toBe(0);
});
