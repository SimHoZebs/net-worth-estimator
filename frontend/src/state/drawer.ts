import { useEffect, useEffectEvent } from "react";
import { useReducedMotion } from "motion/react";

// Shared slide primitives for the single Drawer component: the left
// navigation sheet and the right context sheet slide the full off-canvas
// width on mobile with the same motion; the right sheet keeps its docked
// width on larger viewports. Swipe detection is drawer-agnostic: each call
// site maps a direction to its own meaning with its own hit-test.

export const DRAWER_EASE = "easeOut" as const;
export const DRAWER_OPEN_DURATION = 0.2;
export const DRAWER_CLOSE_DURATION = 0.12;
export const DRAWER_BACKDROP_DURATION = 0.15;
export const DRAWER_DESKTOP_OFFSET = 48;

export type DrawerSide = "left" | "right";

// Reference-counted modal lock: overlapping drawers (nav sheet plus a
// context sheet) share one body scroll lock and one root inert. Saving and
// restoring per drawer races when both close together and leaves the body
// stuck hidden or the background interactive while a sheet is still open.
let modalLockCount = 0;
let savedBodyOverflow: string | null = null;

export function acquireModalLock(): void {
	if (typeof document === "undefined") return;
	if (modalLockCount === 0) {
		savedBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		document.getElementById("root")?.setAttribute("inert", "");
	}
	modalLockCount += 1;
}

export function releaseModalLock(): void {
	if (typeof document === "undefined") return;
	modalLockCount = Math.max(0, modalLockCount - 1);
	if (modalLockCount === 0) {
		document.body.style.overflow = savedBodyOverflow ?? "";
		savedBodyOverflow = null;
		document.getElementById("root")?.removeAttribute("inert");
	}
}

/** Off-canvas resting position: full width on mobile, subtle offset docked. */
export function drawerHiddenX(
	side: DrawerSide,
	full: boolean,
): string | number {
	if (full) return side === "left" ? "-100%" : "100%";
	return side === "left" ? -DRAWER_DESKTOP_OFFSET : DRAWER_DESKTOP_OFFSET;
}

export function useDrawerTransition(closing: boolean): {
	duration: number;
	ease: typeof DRAWER_EASE;
} {
	const reduceMotion = useReducedMotion();
	return {
		duration: reduceMotion
			? 0
			: closing
				? DRAWER_CLOSE_DURATION
				: DRAWER_OPEN_DURATION,
		ease: DRAWER_EASE,
	};
}

export function useDrawerBackdropTransition(): {
	duration: number;
	ease: typeof DRAWER_EASE;
} {
	const reduceMotion = useReducedMotion();
	return {
		duration: reduceMotion ? 0 : DRAWER_BACKDROP_DURATION,
		ease: DRAWER_EASE,
	};
}

export function useHorizontalSwipe({
	enabled,
	onSwipeLeft,
	onSwipeRight,
}: {
	enabled: boolean;
	onSwipeLeft?: (dx: number, origin: EventTarget | null) => void;
	onSwipeRight?: (dx: number, origin: EventTarget | null) => void;
}) {
	// Latest callbacks through events: the gesture listeners below subscribe
	// once per enabled lifetime and always invoke the current handlers, so a
	// callback rerender never resets an active gesture.
	const handleSwipeLeft = useEffectEvent(
		(dx: number, origin: EventTarget | null) => {
			onSwipeLeft?.(dx, origin);
		},
	);
	const handleSwipeRight = useEffectEvent(
		(dx: number, origin: EventTarget | null) => {
			onSwipeRight?.(dx, origin);
		},
	);
	useEffect(() => {
		if (!enabled) return;
		const MIN_DISTANCE = 64;
		// Horizontal travel must dominate vertical travel so diagonal
		// scrolling is not hijacked.
		const DIRECTION_RATIO = 1.5;
		const SCROLL_SLOP = 1;
		const nearestHorizontalScroller = (
			origin: EventTarget | null,
		): Element | null => {
			if (!(origin instanceof Element)) return null;
			if (origin.closest('input[type="range"], [data-swipe-ignore]')) {
				return origin;
			}
			let node: Element | null = origin;
			while (node && node !== document.body) {
				if (node.scrollWidth > node.clientWidth + SCROLL_SLOP) return node;
				node = node.parentElement;
			}
			return null;
		};
		const scrollerConsumes = (scroller: Element, dx: number): boolean => {
			// A range input or explicit opt-out always owns the gesture.
			if (scroller.matches('input[type="range"], [data-swipe-ignore]')) {
				return true;
			}
			// A rightward finger swipe scrolls content right, i.e. the
			// container scrolls left while scrollLeft stays positive; a
			// leftward swipe needs headroom on the right edge.
			return dx > 0
				? scroller.scrollLeft > SCROLL_SLOP
				: scroller.scrollLeft + scroller.clientWidth <
						scroller.scrollWidth - SCROLL_SLOP;
		};
		let startX = 0;
		let startY = 0;
		let tracking = false;
		let startTarget: EventTarget | null = null;
		const onTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) {
				tracking = false;
				return;
			}
			const touch = event.touches[0];
			if (!touch) {
				tracking = false;
				return;
			}
			startX = touch.clientX;
			startY = touch.clientY;
			startTarget = event.target;
			tracking = true;
		};
		const onTouchEnd = (event: TouchEvent) => {
			if (!tracking) return;
			tracking = false;
			if (event.changedTouches.length !== 1) return;
			const touch = event.changedTouches[0];
			if (!touch) return;
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (Math.abs(dx) < MIN_DISTANCE) return;
			if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;
			// Lowest priority: a scroller that can move further in the swipe
			// direction consumes the gesture instead of the swipe handler.
			const scroller = nearestHorizontalScroller(startTarget);
			if (scroller && scrollerConsumes(scroller, dx)) return;
			if (dx < 0) handleSwipeLeft(dx, startTarget);
			else handleSwipeRight(dx, startTarget);
		};
		window.addEventListener("touchstart", onTouchStart, { passive: true });
		window.addEventListener("touchend", onTouchEnd, { passive: true });
		return () => {
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchend", onTouchEnd);
		};
	}, [enabled]);
}
