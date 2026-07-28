// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedStochasticConfig } from "./useDebouncedStochasticConfig";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("useDebouncedStochasticConfig", () => {
	it("flushes pending valid configuration when its page unmounts", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, unmount } = renderHook(() =>
			useDebouncedStochasticConfig({ runCount: 1000, seed: null }, onChange),
		);

		act(() => result.current.updateRunCountInput("2500"));
		expect(onChange).not.toHaveBeenCalled();

		unmount();

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith({ runCount: 2500, seed: null });
	});
});
