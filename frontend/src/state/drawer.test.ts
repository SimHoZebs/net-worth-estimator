import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHorizontalSwipe } from "./drawer.ts";

beforeEach(() => {
	vi.spyOn(window, "addEventListener");
	vi.spyOn(window, "removeEventListener");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("horizontal swipe callbacks", () => {
	function touchEvent(type: "touchstart" | "touchend", clientX: number) {
		const event = new Event(type, {
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		Object.defineProperty(
			event,
			type === "touchstart" ? "touches" : "changedTouches",
			{ value: [{ clientX, clientY: 100 }] },
		);
		return event;
	}

	function swipeLeft() {
		act(() => {
			window.dispatchEvent(touchEvent("touchstart", 200));
			window.dispatchEvent(touchEvent("touchend", 100));
		});
	}

	function touchListenerCalls(
		spy: { mock: { calls: unknown[][] } },
		type: "touchstart" | "touchend",
	) {
		return spy.mock.calls.filter((call) => call[0] === type).length;
	}

	it("invokes the latest callback without resubscribing mid-gesture", () => {
		const first = vi.fn();
		const second = vi.fn();
		const hook = renderHook(
			({ onSwipeLeft }) => useHorizontalSwipe({ enabled: true, onSwipeLeft }),
			{ initialProps: { onSwipeLeft: first } },
		);
		const adds = touchListenerCalls(
			vi.mocked(window.addEventListener),
			"touchstart",
		);
		// Begin a gesture, swap the callback mid-gesture, then finish it.
		act(() => {
			window.dispatchEvent(touchEvent("touchstart", 200));
		});
		hook.rerender({ onSwipeLeft: second });
		// No resubscribe on callback change: the active gesture survives.
		expect(
			touchListenerCalls(vi.mocked(window.addEventListener), "touchstart"),
		).toBe(adds);
		expect(
			touchListenerCalls(vi.mocked(window.removeEventListener), "touchstart"),
		).toBe(0);
		act(() => {
			window.dispatchEvent(touchEvent("touchend", 100));
		});
		expect(second).toHaveBeenCalledOnce();
		expect(second.mock.calls[0]?.[0]).toBeLessThan(0);
		expect(first).not.toHaveBeenCalled();
		hook.unmount();
	});

	it("tears down listeners when disabled", () => {
		const onSwipeLeft = vi.fn();
		const hook = renderHook(
			({ enabled }) => useHorizontalSwipe({ enabled, onSwipeLeft }),
			{ initialProps: { enabled: true } },
		);
		expect(window.addEventListener).toHaveBeenCalledWith(
			"touchstart",
			expect.any(Function),
			{ passive: true },
		);
		hook.rerender({ enabled: false });
		expect(window.removeEventListener).toHaveBeenCalledWith(
			"touchstart",
			expect.any(Function),
		);
		swipeLeft();
		expect(onSwipeLeft).not.toHaveBeenCalled();
		hook.unmount();
	});
});
