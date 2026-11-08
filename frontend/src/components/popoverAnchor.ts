import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Shared anchor for the top-layer popovers (action menu, category picker).
 * One owner for placement, so a second dropdown cannot invent a second
 * placement rule. Components keep their own content and focus policy.
 */

/** Evaluated at use, not import, so tests can stub the prototype. */
export function supportsPopover() {
	return (
		typeof HTMLElement !== "undefined" &&
		typeof HTMLElement.prototype.showPopover === "function"
	);
}

export function openPopover(element: HTMLElement) {
	if (typeof element.showPopover !== "function") return;
	if (element.matches(":popover-open")) return;
	element.showPopover();
}

export function closePopover(element: HTMLElement) {
	if (typeof element.hidePopover !== "function") return;
	if (!element.matches(":popover-open")) return;
	element.hidePopover();
}

/** Fixed placement for a top-layer popover, flipped above a short viewport. */
export function placePopover(
	popover: HTMLElement,
	trigger: HTMLElement,
	options: { width?: number; align?: "left" | "right" },
) {
	const rect = trigger.getBoundingClientRect();
	const gap = 4;
	const edge = 8;
	const below = window.innerHeight - rect.bottom - edge - gap;
	const above = rect.top - edge - gap;
	const openAbove = below < 220 && above > below;
	const maxHeight = Math.max(120, Math.min(320, openAbove ? above : below));
	const width = Math.min(
		options.width ?? rect.width,
		window.innerWidth - edge * 2,
	);
	const unclamped = options.align === "right" ? rect.right - width : rect.left;
	const left = Math.max(
		edge,
		Math.min(unclamped, window.innerWidth - width - edge),
	);
	Object.assign(popover.style, {
		position: "fixed",
		inset: "auto",
		margin: "0",
		left: `${left}px`,
		width: `${width}px`,
		top: openAbove ? "auto" : `${rect.bottom + gap}px`,
		bottom: openAbove ? `${window.innerHeight - rect.top + gap}px` : "auto",
		maxHeight: `${maxHeight}px`,
		overflowY: "auto",
	});
}

/**
 * Opens, places, and tracks one anchored popover while it is open.
 * Light dismiss and Escape close the popover in the browser. The toggle
 * listener syncs that close back to React state.
 */
export function useAnchoredPopover({
	open,
	triggerRef,
	popoverRef,
	width,
	align = "left",
	onClose,
	onOpenFocus,
}: {
	open: boolean;
	triggerRef: RefObject<HTMLElement | null>;
	popoverRef: RefObject<HTMLElement | null>;
	/** Fixed width, or the trigger width when omitted. */
	width?: number;
	align?: "left" | "right";
	onClose: () => void;
	onOpenFocus?: () => void;
}) {
	const focusRef = useRef(onOpenFocus);
	useEffect(() => {
		focusRef.current = onOpenFocus;
	}, [onOpenFocus]);
	useLayoutEffect(() => {
		const popover = popoverRef.current;
		const trigger = triggerRef.current;
		if (!popover || !trigger) return;
		if (!open) {
			closePopover(popover);
			return;
		}
		if (!supportsPopover()) return;
		const place = () => placePopover(popover, trigger, { width, align });
		place();
		openPopover(popover);
		focusRef.current?.();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open, width, align, triggerRef, popoverRef]);

	useEffect(() => {
		if (!open) return;
		const popover = popoverRef.current;
		if (!popover) return;
		const onToggle = (event: Event) => {
			const next = (event as Event & { newState?: string }).newState;
			if (next === "closed") onClose();
		};
		popover.addEventListener("toggle", onToggle);
		return () => popover.removeEventListener("toggle", onToggle);
	}, [open, popoverRef, onClose]);
}
