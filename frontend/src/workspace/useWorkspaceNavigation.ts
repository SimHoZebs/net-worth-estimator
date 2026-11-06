import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import { isRecord } from "../domain/guards.ts";
import { pageUrl, parseUrl, type WorkspaceRoute } from "./route.ts";
import { type Page, pages } from "./navigation.ts";

function locationUrl(): string {
	return `${window.location.pathname}${window.location.search}`;
}

function readReturnTarget(url: string): EvidenceTarget | null {
	const state: unknown = window.history.state;
	if (!isRecord(state) || !isRecord(state.waypointOverlay)) return null;
	const entry = state.waypointOverlay;
	if (entry.url !== url || !isRecord(entry.returnTo)) return null;
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
	const url = locationUrl();
	return { route: parseUrl(url), returnTo: readReturnTarget(url) };
}

// Preserve the transient Gmail callback flag across workspace navigation
// until the Gmail flow consumes it. Without this merge an overlay open
// would drop `?gmail=connected` before its panel can read it.
function preserveCallbackFlag(url: string): string {
	const current = new URLSearchParams(window.location.search);
	const flag = current.get("gmail");
	if (flag === null) return url;
	const next = new URLSearchParams(
		url.includes("?") ? url.slice(url.indexOf("?") + 1) : "",
	);
	if (next.has("gmail")) return url;
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}gmail=${encodeURIComponent(flag)}`;
}

function commitUrl(
	url: string,
	returnTo: EvidenceTarget | null,
	replace: boolean,
	setLocation: (location: {
		route: WorkspaceRoute;
		returnTo: EvidenceTarget | null;
	}) => void,
): void {
	const next = preserveCallbackFlag(url);
	const state: unknown = window.history.state;
	// Return context belongs to this history entry. Every ordinary navigation
	// explicitly starts without it, and Back/Forward restore the entry's value.
	const nextState = {
		...(isRecord(state) ? state : {}),
		waypointOverlay: { url: next, returnTo },
	};
	if (replace) {
		window.history.replaceState(nextState, "", next);
	} else {
		if (locationUrl() !== next) {
			window.history.pushState(nextState, "", next);
		} else {
			window.history.replaceState(nextState, "", next);
		}
	}
	setLocation(readLocation());
	// pushState and replaceState fire no event, so sibling navigation
	// instances (pages that read the route themselves) stay in sync
	// through the same popstate listeners as real Back/Forward moves.
	window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Navigate to a workspace URL from outside the navigation hook (for
 *  components that own no navigation instance). */
export function navigateToUrl(url: string): void {
	const next = preserveCallbackFlag(url);
	const state: unknown = window.history.state;
	window.history.pushState(
		{
			...(isRecord(state) ? state : {}),
			waypointOverlay: { url: next, returnTo: null },
		},
		"",
		next,
	);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useWorkspaceNavigation() {
	const [location, setLocation] = useState(readLocation);
	const { route, returnTo } = location;
	const headingRef = useRef<HTMLHeadingElement>(null);
	const pageRef = useRef(route.page);
	const page = route.page;
	const currentPage = pages.find((item) => item.id === page) ?? pages[0]!;
	useEffect(() => {
		// The root path is the outlook landing page. Canonicalize it
		// once so bookmarks and direct loads share the `/outlook` URL.
		const pathname = window.location.pathname;
		if (pathname === "/" || pathname === "/index.html") {
			const search = window.location.search;
			window.history.replaceState(
				window.history.state,
				"",
				search ? `/outlook${search}` : "/outlook",
			);
			// The initial state already parses the root as outlook, so
			// only the URL changed; notify sibling instances of it.
			window.dispatchEvent(new PopStateEvent("popstate"));
		}
		const onRouteChange = () => {
			const next = readLocation();
			const previous = pageRef.current;
			pageRef.current = next.route.page;
			setLocation(next);
			// Overlay-only changes (opening or closing a modal) leave
			// focus alone: the dialog owns focus while open and restores it
			// on close. Only a page switch moves focus to the heading.
			if (next.route.page !== previous) {
				requestAnimationFrame(() => headingRef.current?.focus());
			}
		};
		// Back/Forward moves arrive as popstate. Hash changes are in-page
		// anchors (the skip link); the parser ignores the hash, so a
		// hashchange leaves the route untouched.
		window.addEventListener("popstate", onRouteChange);
		window.addEventListener("hashchange", onRouteChange);
		// Workspace links are real URLs for bookmarks, middle-click, and
		// copy-link. Plain left-clicks stay in the app via pushState so
		// navigation never reloads the document.
		const onLinkClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
				return;
			const target = event.target as HTMLElement | null;
			const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
			if (!anchor) return;
			const href = anchor.getAttribute("href") ?? "";
			if (!href.startsWith("/") || href.startsWith("//")) return;
			if (anchor.target && anchor.target !== "_self") return;
			const url = new URL(href, window.location.origin);
			const segments = url.pathname.split("/").filter(Boolean);
			const isWorkspaceRoute =
				url.pathname === "/" ||
				(segments.length === 1 &&
					pages.some((item) => item.id === segments[0]));
			if (!isWorkspaceRoute) return;
			event.preventDefault();
			commitUrl(`${url.pathname}${url.search}`, null, false, setLocation);
		};
		document.addEventListener("click", onLinkClick);
		return () => {
			window.removeEventListener("popstate", onRouteChange);
			window.removeEventListener("hashchange", onRouteChange);
			document.removeEventListener("click", onLinkClick);
		};
	}, []);
	const writeUrl = useCallback(
		(url: string, returnTarget: EvidenceTarget | null, replace: boolean) => {
			commitUrl(url, returnTarget, replace, setLocation);
		},
		[],
	);
	const pushUrl = useCallback(
		(url: string, target: EvidenceTarget | null = null) => {
			writeUrl(url, target, false);
		},
		[writeUrl],
	);
	const replaceUrl = useCallback(
		(url: string) => {
			writeUrl(url, null, true);
		},
		[writeUrl],
	);
	const navigate = useCallback(
		(next: Page) => {
			pushUrl(pageUrl(next));
		},
		[pushUrl],
	);
	return {
		route,
		page,
		currentPage,
		returnTo,
		headingRef,
		navigate,
		pushUrl,
		replaceUrl,
	};
}
