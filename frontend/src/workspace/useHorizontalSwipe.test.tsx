import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHorizontalSwipe } from "./useHorizontalSwipe.ts";

type Touch = { clientX: number; clientY: number };

function touchEvent(
	type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
	touches: Touch[] = [],
	changedTouches: Touch[] = [],
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "touches", { value: touches });
	Object.defineProperty(event, "changedTouches", { value: changedTouches });
	return event;
}

function gesture(
	target: Element,
	{ dx = 120, dy = 0 }: { dx?: number; dy?: number } = {},
) {
	const startX = 80;
	const startY = 100;
	act(() => {
		target.dispatchEvent(
			touchEvent("touchstart", [{ clientX: startX, clientY: startY }]),
		);
		target.dispatchEvent(
			touchEvent(
				"touchmove",
				[{ clientX: startX + dx / 2, clientY: startY + dy / 2 }],
				[{ clientX: startX + dx / 2, clientY: startY + dy / 2 }],
			),
		);
		target.dispatchEvent(
			touchEvent(
				"touchend",
				[],
				[{ clientX: startX + dx, clientY: startY + dy }],
			),
		);
	});
}

function scroller(
	element: HTMLElement,
	{
		overflowX = "auto",
		scrollWidth = 1000,
		clientWidth = 300,
		left = 0,
	}: {
		overflowX?: string;
		scrollWidth?: number;
		clientWidth?: number;
		left?: number;
	} = {},
) {
	element.style.overflowX = overflowX;
	Object.defineProperty(element, "scrollWidth", {
		value: scrollWidth,
		configurable: true,
	});
	Object.defineProperty(element, "clientWidth", {
		value: clientWidth,
		configurable: true,
	});
	let value = left;
	Object.defineProperty(element, "scrollLeft", {
		configurable: true,
		get: () => value,
		set: (next: number) => {
			value = next;
		},
	});
	return {
		getLeft: () => value,
		setLeft: (next: number) => {
			value = next;
		},
	};
}

function target(): HTMLDivElement {
	const element = document.createElement("div");
	container.append(element);
	return element;
}

let container: HTMLElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(() => {
	container.remove();
	vi.restoreAllMocks();
});

describe("useHorizontalSwipe", () => {
	it("opens on a valid rightward swipe", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		gesture(target());
		expect(onSwipeRight).toHaveBeenCalledOnce();
		expect(onSwipeRight.mock.calls[0]?.[0]).toBeGreaterThan(0);
	});

	it("maps leftward travel to the left handler", () => {
		const onSwipeLeft = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeLeft }));
		gesture(target(), { dx: -140 });
		expect(onSwipeLeft).toHaveBeenCalledOnce();
		expect(onSwipeLeft.mock.calls[0]?.[0]).toBeLessThan(0);
	});

	it("calls back during touchmove before touchend and only once", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 90, clientY: 101 }]),
			);
			// Tiny travel so far: nothing yet.
			expect(onSwipeRight).not.toHaveBeenCalled();
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 110, clientY: 101 }]),
			);
			// Horizontal intent is clear from the touchmove itself, before any
			// touchend has been dispatched.
			expect(onSwipeRight).toHaveBeenCalledOnce();
			// Further movement must not re-fire.
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 160, clientY: 101 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 220, clientY: 102 }]),
			);
			expect(onSwipeRight).toHaveBeenCalledOnce();
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 220, clientY: 102 }]),
			);
		});
		// Releasing the touch must not fire a second time.
		expect(onSwipeRight).toHaveBeenCalledOnce();
	});

	it("does not call back on touchstart", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("passes the latest dx observed so far to the callback", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 140, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).toHaveBeenCalledOnce();
		expect(onSwipeRight.mock.calls[0]?.[0]).toBe(60);
	});

	it("ignores tiny horizontal travel below the intent slop", () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight, onSwipeLeft }));
		const element = target();
		// Shorter than the slop, with no touchmove at all, and with a move.
		gesture(element, { dx: 8, dy: 0 });
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 93, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 93, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(onSwipeLeft).not.toHaveBeenCalled();
	});

	it("opens at the small intent slop before touchend", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 93, clientY: 100 }]),
			);
		});
		// 13px is still below the slop.
		expect(onSwipeRight).not.toHaveBeenCalled();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 94, clientY: 100 }]),
			);
		});
		// 14px horizontal travel with no vertical travel clears intent.
		expect(onSwipeRight).toHaveBeenCalledOnce();
	});

	it("requires horizontal travel to dominate vertical travel", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			// Past the slop horizontally, but not by the direction ratio.
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 95, clientY: 111 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("ignores clearly vertical travel", () => {
		const onSwipeRight = vi.fn();
		const onSwipeLeft = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight, onSwipeLeft }));
		gesture(target(), { dx: 8, dy: -200 });
		expect(onSwipeRight).not.toHaveBeenCalled();
		expect(onSwipeLeft).not.toHaveBeenCalled();
	});

	it("locks out a clearly vertical gesture so later horizontal travel cannot hijack it", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			// The gesture starts as a clearly vertical scroll...
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 82, clientY: 140 }]),
			);
			// ...then a horizontal segment large enough to satisfy intent on
			// its own must not open anything.
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 240, clientY: 142 }]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 240, clientY: 142 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("locks out a clearly vertical leftward scroll the same way", () => {
		const onSwipeLeft = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeLeft }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 78, clientY: 60 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: -80, clientY: 58 }]),
			);
		});
		expect(onSwipeLeft).not.toHaveBeenCalled();
	});

	it("keeps ownership when a scroller reaches its edge during the gesture", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const surface = document.createElement("div");
		const element = document.createElement("div");
		surface.append(element);
		container.append(surface);
		const scroll = scroller(surface, { left: 90 });
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			// The browser scrolls the surface while the finger travels.
			scroll.setLeft(0);
			element.dispatchEvent(
				touchEvent(
					"touchmove",
					[{ clientX: 140, clientY: 102 }],
					[{ clientX: 140, clientY: 102 }],
				),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 104 }]),
			);
		});
		expect(scroll.getLeft()).toBe(0);
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("lets a second outward swipe open once the scroller sits at the edge", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const surface = document.createElement("div");
		const element = document.createElement("div");
		surface.append(element);
		container.append(surface);
		scroller(surface, { left: 0 });
		gesture(element);
		expect(onSwipeRight).toHaveBeenCalledOnce();
	});

	it("does not open while a horizontal scroller actually scrolled during the move", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const surface = document.createElement("div");
		const element = document.createElement("div");
		surface.append(element);
		container.append(surface);
		const scroll = scroller(surface, { left: 0 });
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			// The browser scrolls the surface while the finger travels even
			// though the scroller started at its edge.
			scroll.setLeft(12);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 94, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("owns the gesture through nested scrollers", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const outer = document.createElement("div");
		const inner = document.createElement("div");
		const element = document.createElement("div");
		inner.append(element);
		outer.append(inner);
		container.append(outer);
		scroller(outer, { left: 40 });
		const innerScroll = scroller(inner, { left: 90 });
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			// The inner surface hits its edge and the outer surface takes over.
			innerScroll.setLeft(0);
			element.dispatchEvent(
				touchEvent(
					"touchmove",
					[{ clientX: 140, clientY: 102 }],
					[{ clientX: 140, clientY: 102 }],
				),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 104 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("owns the gesture when only an outer scroller scrolls", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const outer = document.createElement("div");
		const inner = document.createElement("div");
		const element = document.createElement("div");
		inner.append(element);
		outer.append(inner);
		container.append(outer);
		scroller(outer, { left: 90 });
		gesture(element);
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("does not treat overflow-hidden content as a scroller", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const surface = document.createElement("div");
		const element = document.createElement("div");
		surface.append(element);
		container.append(surface);
		scroller(surface, { overflowX: "hidden", left: 90 });
		gesture(element);
		expect(onSwipeRight).toHaveBeenCalledOnce();
	});

	it("cancels when a second touch joins the gesture", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent(
					"touchmove",
					[
						{ clientX: 80, clientY: 100 },
						{ clientX: 120, clientY: 100 },
					],
					[
						{ clientX: 80, clientY: 100 },
						{ clientX: 120, clientY: 100 },
					],
				),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("ignores a gesture that starts as a multitouch", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [
					{ clientX: 80, clientY: 100 },
					{ clientX: 120, clientY: 100 },
				]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("ignores a cancelled gesture", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(touchEvent("touchcancel"));
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 200, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("ignores a cancelled gesture before horizontal intent clears", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 90, clientY: 100 }]),
			);
			element.dispatchEvent(touchEvent("touchcancel"));
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 200, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 100 }]),
			);
		});
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("suppresses opening while a role dialog is open", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const modal = document.createElement("div");
		modal.setAttribute("role", "dialog");
		container.append(modal);
		const element = target();
		gesture(element);
		expect(onSwipeRight).not.toHaveBeenCalled();
		modal.remove();
		gesture(element);
		expect(onSwipeRight).toHaveBeenCalledOnce();
	});

	it.each(["dialog", "alertdialog"])(
		"allows a gesture over a non-modal %s",
		(role) => {
			const onSwipeRight = vi.fn();
			renderHook(() => useHorizontalSwipe({ onSwipeRight }));
			const surface = document.createElement("div");
			surface.setAttribute("role", role);
			surface.setAttribute("aria-modal", "false");
			const element = document.createElement("div");
			surface.append(element);
			container.append(surface);
			gesture(element);
			expect(onSwipeRight).toHaveBeenCalledOnce();
		},
	);

	it("suppresses opening while a native dialog is open", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const modal = document.createElement("dialog");
		modal.setAttribute("open", "");
		container.append(modal);
		gesture(target());
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("lets a closing gesture opt out of modal suppression", () => {
		const onSwipeRight = vi.fn();
		renderHook(() =>
			useHorizontalSwipe({
				suppressWhenModalOpen: false,
				onSwipeRight,
			}),
		);
		const modal = document.createElement("div");
		modal.setAttribute("role", "dialog");
		container.append(modal);
		gesture(target());
		expect(onSwipeRight).toHaveBeenCalledOnce();
	});

	it("lets an explicit opt-out own the gesture", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = target();
		element.setAttribute("data-swipe-ignore", "");
		gesture(element);
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("lets a range input own the gesture", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ onSwipeRight }));
		const element = document.createElement("input");
		element.setAttribute("type", "range");
		container.append(element);
		gesture(element);
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("does not open on a swipe while disabled", () => {
		const onSwipeRight = vi.fn();
		renderHook(() => useHorizontalSwipe({ enabled: false, onSwipeRight }));
		gesture(target());
		expect(onSwipeRight).not.toHaveBeenCalled();
	});

	it("invokes the latest callback for a gesture started before a rerender", () => {
		const first = vi.fn();
		const second = vi.fn();
		const hook = renderHook(
			({ onSwipeRight }) => useHorizontalSwipe({ onSwipeRight }),
			{ initialProps: { onSwipeRight: first } },
		);
		const element = target();
		act(() => {
			element.dispatchEvent(
				touchEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
			);
		});
		hook.rerender({ onSwipeRight: second });
		act(() => {
			element.dispatchEvent(
				touchEvent("touchmove", [{ clientX: 200, clientY: 100 }]),
			);
			element.dispatchEvent(
				touchEvent("touchend", [], [{ clientX: 200, clientY: 100 }]),
			);
		});
		expect(second).toHaveBeenCalledOnce();
		expect(first).not.toHaveBeenCalled();
	});
});
