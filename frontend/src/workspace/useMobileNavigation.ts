import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../state/useMediaQuery.ts";

export function useMobileNavigation() {
	const [open, setOpen] = useState(false);
	const mobile = useMediaQuery("(max-width: 800px)");
	const sidebarRef = useRef<HTMLElement>(null);
	const openRef = useRef(open);
	useEffect(() => {
		openRef.current = open;
	}, [open]);
	useEffect(() => {
		// Viewport reset: closing the drawer when leaving mobile widths is the
		// intended sync, not a render cascade.
		// oxlint-disable-next-line react/set-state-in-effect
		if (!mobile) setOpen(false);
	}, [mobile]);
	useEffect(() => {
		const close = () => setOpen(false);
		window.addEventListener("hashchange", close);
		return () => window.removeEventListener("hashchange", close);
	}, []);
	useEffect(() => {
		// Touch gestures: a mostly-horizontal rightward swipe opens the
		// drawer; a leftward swipe starting over the drawer or its backdrop
		// closes it. Listeners are passive and act only on touchend, so
		// vertical scrolling is never intercepted.
		//
		// The open gesture is lowest priority: when the swipe starts inside
		// a container that can scroll further in the swipe direction (for
		// example a sideways-scrollable table), the container owns the
		// gesture and the drawer stays shut.
		if (!mobile) return;
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
			if (
				scroller.matches('input[type="range"], [data-swipe-ignore]')
			) {
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
			// direction consumes the gesture instead of the drawer.
			const scroller = nearestHorizontalScroller(startTarget);
			if (scroller && scrollerConsumes(scroller, dx)) return;
			if (openRef.current) {
				if (dx >= 0) return;
				const origin = startTarget;
				const overSidebar =
					origin instanceof Node &&
					(sidebarRef.current?.contains(origin) ||
						(origin instanceof Element &&
							origin.classList.contains("nav-backdrop")));
				if (overSidebar) setOpen(false);
				return;
			}
			if (dx > 0) setOpen(true);
		};
		window.addEventListener("touchstart", onTouchStart, { passive: true });
		window.addEventListener("touchend", onTouchEnd, { passive: true });
		return () => {
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchend", onTouchEnd);
		};
	}, [mobile]);
	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement;
		sidebarRef.current?.querySelector<HTMLElement>("button")?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
			if (event.key !== "Tab") return;
			const elements = Array.from(
				sidebarRef.current?.querySelectorAll<HTMLElement>(
					"a[href], button:not(:disabled)",
				) ?? [],
			);
			const first = elements[0];
			const last = elements.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			}
			if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, [open]);
	return {
		open,
		mobile,
		sidebarRef,
		close: () => setOpen(false),
		show: () => setOpen(true),
	};
}
