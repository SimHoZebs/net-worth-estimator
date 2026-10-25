import { useCallback, useEffect, useState } from "react";
import { useHorizontalSwipe } from "../components/drawer.ts";
import { useHasOpenDialog } from "../components/dialogPresence.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";

export function useMobileNavigation() {
	const [open, setOpen] = useState(false);
	const mobile = useMediaQuery(viewportQueries.belowMd);
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
	// The hamburger is already unreachable while a dialog holds the top
	// layer (root inert plus showModal). The window swipe listener bypasses
	// inertness, so it reads presence from React state and never stacks the
	// nav sheet above an open modal.
	const hasDialog = useHasOpenDialog();
	const show = useCallback(() => {
		if (open || hasDialog) return;
		setOpen(true);
	}, [open, hasDialog]);
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
