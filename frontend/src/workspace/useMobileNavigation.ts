import { useEffect, useRef, useState } from "react";
import { useHorizontalSwipe } from "../components/drawer.ts";
import { useMediaQuery } from "../state/useMediaQuery.ts";

export function useMobileNavigation() {
	const [open, setOpen] = useState(false);
	const mobile = useMediaQuery("(max-width: 800px)");
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
	// Opening gesture only: a mostly-horizontal rightward swipe opens the
	// drawer. Closing (leftward swipe, Escape, backdrop, focus) is owned by
	// the shared Drawer component. Listeners are passive and act only on
	// touchend, so vertical scrolling is never intercepted.
	useHorizontalSwipe({
		enabled: mobile,
		onSwipeRight: () => {
			if (!openRef.current) setOpen(true);
		},
	});
	return {
		open,
		mobile,
		close: () => setOpen(false),
		show: () => setOpen(true),
	};
}
