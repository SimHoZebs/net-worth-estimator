import { useCallback, useEffect, useRef, useState } from "react";
import { pageHash, parseHash, type WorkspaceRoute } from "./route.ts";
import { type Page, pages } from "./navigation.ts";

export function useWorkspaceNavigation() {
	const [route, setRoute] = useState<WorkspaceRoute>(() =>
		parseHash(window.location.hash),
	);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const pageRef = useRef(route.page);
	const page = route.page;
	const currentPage = pages.find((item) => item.id === page) ?? pages[0]!;
	useEffect(() => {
		const onHash = () => {
			const next = parseHash(window.location.hash);
			const previous = pageRef.current;
			pageRef.current = next.page;
			setRoute(next);
			// Overlay-only hash changes (opening or closing a modal) leave
			// focus alone: the dialog owns focus while open and restores it
			// on close. Only a page switch moves focus to the heading.
			if (next.page !== previous) {
				requestAnimationFrame(() => headingRef.current?.focus());
			}
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);
	useEffect(() => {
		document.title = `${currentPage.label} · Waypoint`;
	}, [currentPage.label]);
	const pushHash = useCallback((hash: string) => {
		if (window.location.hash === hash) {
			setRoute(parseHash(hash));
			return;
		}
		window.location.hash = hash;
		// Eager sync so the modal appears without waiting for the hashchange
		// round trip; the listener reconciles to the same value.
		setRoute(parseHash(hash));
	}, []);
	const replaceHash = useCallback((hash: string) => {
		window.history.replaceState(null, "", hash);
		setRoute(parseHash(hash));
	}, []);
	const navigate = useCallback(
		(next: Page) => {
			pushHash(pageHash(next));
		},
		[pushHash],
	);
	return {
		route,
		page,
		currentPage,
		headingRef,
		navigate,
		pushHash,
		replaceHash,
	};
}
