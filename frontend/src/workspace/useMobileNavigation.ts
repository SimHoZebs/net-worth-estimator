import { useEffect, useRef, useState } from "react";
import { useHorizontalSwipe } from "../components/drawer.ts";
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
	// Touch gestures: a mostly-horizontal rightward swipe opens the drawer;
	// a leftward swipe starting over the drawer or its backdrop closes it.
	// Listeners are passive and act only on touchend, so vertical scrolling
	// is never intercepted.
	useHorizontalSwipe({
		enabled: mobile,
		onSwipeRight: () => {
			if (!openRef.current) setOpen(true);
		},
		onSwipeLeft: (_dx, origin) => {
			if (!openRef.current) return;
			const overSidebar =
				origin instanceof Node &&
				(sidebarRef.current?.contains(origin) ||
					(origin instanceof Element &&
						origin.classList.contains("nav-backdrop")));
			if (overSidebar) setOpen(false);
		},
	});
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
