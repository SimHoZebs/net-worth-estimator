import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acquireModalLock,
	DRAWER_CLOSE_DURATION,
	DRAWER_DESKTOP_OFFSET,
	DRAWER_OPEN_DURATION,
	drawerHiddenX,
	releaseModalLock,
	useHorizontalSwipe,
} from "./drawer.ts";

beforeEach(() => {
	vi.spyOn(window, "addEventListener");
	vi.spyOn(window, "removeEventListener");
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.style.overflow = "";
	document.getElementById("root")?.remove();
});

describe("shared drawer slide", () => {
	it("slides the full off-canvas width on mobile, mirrored by side", () => {
		expect(drawerHiddenX("left", true)).toBe("-100%");
		expect(drawerHiddenX("right", true)).toBe("100%");
	});

	it("keeps a subtle docked offset on larger viewports, mirrored by side", () => {
		expect(drawerHiddenX("left", false)).toBe(-DRAWER_DESKTOP_OFFSET);
		expect(drawerHiddenX("right", false)).toBe(DRAWER_DESKTOP_OFFSET);
	});

	it("opens slower than it closes", () => {
		expect(DRAWER_OPEN_DURATION).toBeGreaterThan(DRAWER_CLOSE_DURATION);
	});
});

describe("modal lock", () => {
	it("holds scroll and inertness until the last sheet closes", () => {
		const root = document.createElement("div");
		root.id = "root";
		document.body.appendChild(root);
		document.body.style.overflow = "";
		acquireModalLock();
		acquireModalLock();
		releaseModalLock();
		expect(document.body.style.overflow).toBe("hidden");
		expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
		releaseModalLock();
		expect(document.body.style.overflow).toBe("");
		expect(
			document.getElementById("root")?.hasAttribute("inert") ?? false,
		).toBe(false);
	});
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
