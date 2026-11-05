import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useHorizontalSwipe } from "../state/drawer.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import { useAnyModalOpen } from "../state/modalPresence.ts";

// The open flag outlives one layout instance. The boot shell and the loaded
// workspace each render their own layout, and the swap unmounts the boot one:
// a hamburger tap while hydration finishes must not lose the open sheet.
let navOpen = false;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function setNavOpen(next: boolean) {
	if (navOpen === next) return;
	navOpen = next;
	emit();
}

/** Test hook: module state outlives files' renders, so files reset it. */
export function resetMobileNavigationState() {
	setNavOpen(false);
}

export function useMobileNavigation() {
	const open = useSyncExternalStore(
		subscribe,
		() => navOpen,
		() => false,
	);
	// The browser's breakpoint event owns dismissal, rather than an effect
	// that watches the rendered breakpoint and repairs the open state later.
	const onViewportChange = useCallback((mobile: boolean) => {
		if (!mobile) setNavOpen(false);
	}, []);
	const mobile = useMediaQuery(viewportQueries.belowMd, onViewportChange);
	useEffect(() => {
		const close = () => setNavOpen(false);
		window.addEventListener("hashchange", close);
		return () => window.removeEventListener("hashchange", close);
	}, []);
	// Opening gesture only: a mostly-horizontal rightward swipe opens the
	// drawer. Closing (leftward swipe, Escape, backdrop, focus) is owned by
	// the shared Drawer component. Listeners are passive and act only on
	// touchend, so vertical scrolling is never intercepted.
	// The hamburger is unreachable while a modal dialog holds the top layer
	// because the page is inert. The window swipe listener bypasses
	// inertness, so it reads the registered modal presence and never stacks
	// the nav sheet above an open dialog.
	const anyModalOpen = useAnyModalOpen();
	const show = useCallback(() => {
		if (!mobile || open || anyModalOpen) return;
		setNavOpen(true);
	}, [mobile, open, anyModalOpen]);
	useHorizontalSwipe({
		enabled: mobile,
		onSwipeRight: () => {
			show();
		},
	});
	return {
		open,
		mobile,
		close: () => setNavOpen(false),
		show,
	};
}
