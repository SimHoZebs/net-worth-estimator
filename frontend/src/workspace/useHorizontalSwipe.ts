import { useEffect, useEffectEvent } from "react";

const MIN_SWIPE_DISTANCE = 14;
// Horizontal travel must dominate vertical travel so diagonal scrolling is
// not hijacked.
const DIRECTION_RATIO = 1.5;
const SCROLL_SLOP = 1;
const IGNORE_SELECTOR = 'input[type="range"], [data-swipe-ignore]';
// Non-modal dialog surfaces such as toasts explicitly set aria-modal=false.
const MODAL_SELECTOR =
	'[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]:not([aria-modal="false"]), [aria-modal="true"], dialog[open]';

type ScrollOwner = {
	element: Element;
	startLeft: number;
	startRight: number;
};

/** Horizontal swipe arbitration shared by workspace overlays. The hook owns
 *  the gesture only: each call site maps a direction to its own open or close
 *  action. A gesture belongs to a horizontal scroller when that scroller
 *  owned the direction at touch start or actually scrolled during the
 *  gesture. */
export function useHorizontalSwipe({
	enabled = true,
	suppressWhenModalOpen = true,
	onSwipeLeft,
	onSwipeRight,
}: {
	enabled?: boolean;
	/** Window listeners bypass inert, so an open modal is checked explicitly.
	 *  Closing gestures pass false to stay reachable while their sheet is
	 *  open. */
	suppressWhenModalOpen?: boolean;
	onSwipeLeft?: (dx: number, origin: EventTarget | null) => void;
	onSwipeRight?: (dx: number, origin: EventTarget | null) => void;
}) {
	// Latest callbacks through events: the gesture listeners subscribe once
	// per enabled lifetime and always invoke the current handlers, so a
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

		const modalIsOpen = () => Boolean(document.querySelector(MODAL_SELECTOR));

		// Every horizontally scrollable ancestor owns the gesture at touch
		// start. The nearest scroller alone is not enough: nested scrollers
		// hand the gesture off as an inner edge is reached.
		const scrollOwners = (origin: Element | null): ScrollOwner[] => {
			const owners: ScrollOwner[] = [];
			for (
				let node: Element | null = origin;
				node && node !== document.body;
				node = node.parentElement
			) {
				const overflowX = getComputedStyle(node).overflowX;
				if (overflowX !== "auto" && overflowX !== "scroll") continue;
				if (node.scrollWidth <= node.clientWidth + SCROLL_SLOP) continue;
				owners.push({
					element: node,
					startLeft: node.scrollLeft,
					startRight: node.scrollWidth - node.clientWidth - node.scrollLeft,
				});
			}
			return owners;
		};

		let startX = 0;
		let startY = 0;
		let startTarget: EventTarget | null = null;
		let owners: ScrollOwner[] = [];
		let tracking = false;

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
			if (suppressWhenModalOpen && modalIsOpen()) {
				tracking = false;
				return;
			}
			const origin = event.target instanceof Element ? event.target : null;
			// A range input or an explicit opt-out always owns the gesture.
			if (origin?.closest(IGNORE_SELECTOR)) {
				tracking = false;
				return;
			}
			startX = touch.clientX;
			startY = touch.clientY;
			startTarget = event.target;
			owners = scrollOwners(origin);
			tracking = true;
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!tracking) return;
			if (event.touches.length !== 1) {
				tracking = false;
				return;
			}
			for (const owner of owners) {
				if (
					Math.abs(owner.element.scrollLeft - owner.startLeft) > SCROLL_SLOP
				) {
					tracking = false;
					return;
				}
			}
			const touch = event.touches[0];
			if (!touch) return;
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (
				Math.abs(dy) >= MIN_SWIPE_DISTANCE &&
				Math.abs(dy) > Math.abs(dx) * DIRECTION_RATIO
			) {
				tracking = false;
				return;
			}
			if (Math.abs(dx) < MIN_SWIPE_DISTANCE) return;
			if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;
			// Resolve once while the finger is down. Releasing the touch or
			// continuing the gesture must never fire another action.
			tracking = false;
			if (suppressWhenModalOpen && modalIsOpen()) return;
			// Ownership is decided at touch start, so a scroller that reached
			// its edge during the gesture still consumed the swipe. A
			// scroller already at the edge in the swipe direction does not.
			const consumed = owners.some((owner) =>
				dx > 0 ? owner.startLeft > SCROLL_SLOP : owner.startRight > SCROLL_SLOP,
			);
			if (consumed) return;
			if (dx < 0) handleSwipeLeft(dx, startTarget);
			else handleSwipeRight(dx, startTarget);
		};

		const onTouchCancel = () => {
			tracking = false;
		};

		window.addEventListener("touchstart", onTouchStart, { passive: true });
		window.addEventListener("touchmove", onTouchMove, { passive: true });
		window.addEventListener("touchend", onTouchCancel, { passive: true });
		window.addEventListener("touchcancel", onTouchCancel, { passive: true });
		return () => {
			window.removeEventListener("touchstart", onTouchStart);
			window.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("touchend", onTouchCancel);
			window.removeEventListener("touchcancel", onTouchCancel);
		};
	}, [enabled, suppressWhenModalOpen]);
}
