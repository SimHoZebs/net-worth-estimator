// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StochasticConfig } from "@/lib/projection";
import { useDebouncedStochasticConfig } from "./useDebouncedStochasticConfig";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("useDebouncedStochasticConfig", () => {
	it("rebases a pending run count onto a newer controlled seed", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, rerender } = renderHook(
			({ config }) => useDebouncedStochasticConfig(config, onChange),
			{
				initialProps: {
					config: { runCount: 1000, seed: null } as StochasticConfig,
				},
			},
		);

		act(() => result.current.updateRunCountInput("2500"));
		rerender({ config: { runCount: 1500, seed: 42 } });

		expect(result.current.runCountInput).toBe("2500");
		expect(result.current.seedInput).toBe("42");

		act(() => vi.advanceTimersByTime(2000));

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith({ runCount: 2500, seed: 42 });
	});

	it("rebases a pending seed onto a newer controlled run count", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, rerender } = renderHook(
			({ config }) => useDebouncedStochasticConfig(config, onChange),
			{
				initialProps: {
					config: { runCount: 1000, seed: null } as StochasticConfig,
				},
			},
		);

		act(() => result.current.updateSeedInput("7"));
		rerender({ config: { runCount: 1500, seed: 42 } });

		expect(result.current.runCountInput).toBe("1500");
		expect(result.current.seedInput).toBe("7");

		act(() => vi.advanceTimersByTime(2000));

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith({ runCount: 1500, seed: 7 });
	});

	it("applies rebased pending intent immediately and cancels the timeout", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, rerender } = renderHook(
			({ config }) => useDebouncedStochasticConfig(config, onChange),
			{
				initialProps: {
					config: { runCount: 1000, seed: null } as StochasticConfig,
				},
			},
		);

		act(() => result.current.updateRunCountInput("2500"));
		rerender({ config: { runCount: 1500, seed: 42 } });
		act(() => result.current.applyImmediately());

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith({ runCount: 2500, seed: 42 });

		act(() => vi.advanceTimersByTime(2000));
		expect(onChange).toHaveBeenCalledOnce();
	});

	it("flushes rebased pending intent when its page unmounts", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, rerender, unmount } = renderHook(
			({ config }) => useDebouncedStochasticConfig(config, onChange),
			{
				initialProps: {
					config: { runCount: 1000, seed: null } as StochasticConfig,
				},
			},
		);

		act(() => result.current.updateRunCountInput("2500"));
		rerender({ config: { runCount: 1500, seed: 42 } });
		expect(onChange).not.toHaveBeenCalled();

		unmount();

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith({ runCount: 2500, seed: 42 });
	});

	it("does not overwrite a newer run count with an invalid draft", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, rerender } = renderHook(
			({ config }) => useDebouncedStochasticConfig(config, onChange),
			{
				initialProps: {
					config: { runCount: 1000, seed: null } as StochasticConfig,
				},
			},
		);

		act(() => result.current.updateRunCountInput("-"));
		rerender({ config: { runCount: 1500, seed: 42 } });

		expect(result.current.runCountInput).toBe("-");
		act(() => vi.advanceTimersByTime(2000));

		expect(onChange).not.toHaveBeenCalled();
		expect(result.current.runCountInput).toBe("1500");
	});

	it("does not overwrite a newer seed with an invalid draft", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const { result, rerender } = renderHook(
			({ config }) => useDebouncedStochasticConfig(config, onChange),
			{
				initialProps: {
					config: { runCount: 1000, seed: null } as StochasticConfig,
				},
			},
		);

		act(() => result.current.updateSeedInput("-"));
		rerender({ config: { runCount: 1500, seed: 42 } });

		expect(result.current.seedInput).toBe("-");
		act(() => vi.advanceTimersByTime(2000));

		expect(onChange).not.toHaveBeenCalled();
		expect(result.current.seedInput).toBe("42");
	});
});
