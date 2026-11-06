import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import {
	createRouter,
	stringifySearchWith,
	type RouterHistory,
} from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen.ts";
import { parseWorkspaceSearch } from "./overlaySearch.ts";

// Per-navigation history state: the editor's return target. Ordinary
// navigations start without it; Back/Forward restore the entry's value.
declare module "@tanstack/react-router" {
	interface HistoryState {
		returnTo?: EvidenceTarget;
	}
}

export function createWorkspaceRouter(history?: RouterHistory) {
	const router = createRouter({
		routeTree,
		parseSearch: parseWorkspaceSearch,
		// No JSON quoting for strings: copied links and generated links use
		// the same plain-string query contract.
		stringifySearch: stringifySearchWith(JSON.stringify),
		// Explicit so tests can pass a memory history. The production app
		// uses the default browser history.
		...(history ? { history } : {}),
		scrollRestoration: true,
		defaultPreload: "intent",
		// Intent preloads route code only. Page query hooks own data
		// freshness and the authenticated resource-scope gate.
		// Page switches should land at the top; search-only overlay moves
		// opt out per-navigation with resetScroll: false.
		scrollRestorationBehavior: "auto",
	});
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createWorkspaceRouter>;
	}
}
