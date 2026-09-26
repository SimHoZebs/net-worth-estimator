import { useEffect, useRef, useState } from "react";
import { getPage, type Page, pages } from "./navigation.ts";

export function useWorkspaceNavigation() {
	const [page, setPage] = useState<Page>(getPage);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const currentPage = pages.find((item) => item.id === page) ?? pages[0]!;
	useEffect(() => {
		const onHash = () => {
			setPage(getPage());
			requestAnimationFrame(() => headingRef.current?.focus());
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);
	useEffect(() => {
		document.title = `${currentPage.label} · Waypoint`;
	}, [currentPage.label]);
	const navigate = (next: Page) => {
		window.location.hash = next;
		setPage(next);
	};
	return { page, currentPage, headingRef, navigate };
}
