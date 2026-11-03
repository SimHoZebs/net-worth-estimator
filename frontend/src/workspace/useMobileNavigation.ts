import { useCallback, useEffect, useState } from "react";
import { useHorizontalSwipe } from "../state/drawer.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import { useAnyModalOpen } from "../state/modalPresence.ts";

export function useMobileNavigation() {
	const [open, setOpen] = useState(false);
	// The browser's breakpoint event owns dismissal, rather than an effect
	// that watches the rendered breakpoint and repairs the open state later.
	const onViewportChange = useCallback((mobile: boolean) => {
		if (!mobile) setOpen(false);
	}, []);
	const mobile = useMediaQuery(viewportQueries.belowMd, onViewportChange);
	useEffect(() => {
		const close = () => setOpen(false);
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
		setOpen(true);
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
		close: () => setOpen(false),
		show,
	};
}
