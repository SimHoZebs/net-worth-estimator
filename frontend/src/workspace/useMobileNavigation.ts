import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../state/useMediaQuery.ts";

export function useMobileNavigation() {
	const [open, setOpen] = useState(false);
	const mobile = useMediaQuery("(max-width: 800px)");
	const sidebarRef = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!mobile) setOpen(false);
	}, [mobile]);
	useEffect(() => {
		const close = () => setOpen(false);
		window.addEventListener("hashchange", close);
		return () => window.removeEventListener("hashchange", close);
	}, []);
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
