import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import { isRecord } from "../domain/guards.ts";
import { pageHash, parseHash, type WorkspaceRoute } from "./route.ts";
import { type Page, pages } from "./navigation.ts";

function readReturnTarget(hash: string): EvidenceTarget | null {
	const state: unknown = window.history.state;
	if (!isRecord(state) || !isRecord(state.waypointOverlay)) return null;
	const entry = state.waypointOverlay;
	if (entry.hash !== hash || !isRecord(entry.returnTo)) return null;
	const target = entry.returnTo;
	switch (target.kind) {
		case "position":
		case "failure":
		case "safe-spending":
			return { kind: target.kind };
		case "account":
			return typeof target.id === "string"
				? { kind: "account", id: target.id }
				: null;
		default:
			return null;
	}
}

function readLocation(): {
	route: WorkspaceRoute;
	returnTo: EvidenceTarget | null;
} {
	const hash = window.location.hash;
	return { route: parseHash(hash), returnTo: readReturnTarget(hash) };
}

export function useWorkspaceNavigation() {
	const [location, setLocation] = useState(readLocation);
	const { route, returnTo } = location;
	const headingRef = useRef<HTMLHeadingElement>(null);
	const pageRef = useRef(route.page);
	const page = route.page;
	const currentPage = pages.find((item) => item.id === page) ?? pages[0]!;
	useEffect(() => {
		const onHash = () => {
			const next = readLocation();
			const previous = pageRef.current;
			pageRef.current = next.route.page;
			setLocation(next);
			// Overlay-only hash changes (opening or closing a modal) leave
			// focus alone: the dialog owns focus while open and restores it
			// on close. Only a page switch moves focus to the heading.
			if (next.route.page !== previous) {
				requestAnimationFrame(() => headingRef.current?.focus());
			}
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);
	const writeHash = useCallback(
		(hash: string, returnTarget: EvidenceTarget | null, replace: boolean) => {
			if (!replace && window.location.hash !== hash)
				window.location.hash = hash;
			const state: unknown = window.history.state;
			// Return context belongs to this history entry. Every ordinary navigation
			// explicitly starts without it, and Back/Forward restore the entry's value.
			window.history.replaceState(
				{
					...(isRecord(state) ? state : {}),
					waypointOverlay: { hash, returnTo: returnTarget },
				},
				"",
				hash,
			);
			setLocation(readLocation());
		},
		[],
	);
	const pushHash = useCallback(
		(hash: string, target: EvidenceTarget | null = null) => {
			writeHash(hash, target, false);
		},
		[writeHash],
	);
	const replaceHash = useCallback(
		(hash: string) => {
			writeHash(hash, null, true);
		},
		[writeHash],
	);
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
		returnTo,
		headingRef,
		navigate,
		pushHash,
		replaceHash,
	};
}
