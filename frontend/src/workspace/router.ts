import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "../routeTree.gen.ts";
import {
	parseWorkspaceSearch,
	stringifyWorkspaceSearch,
} from "./overlaySearch.ts";
import { WorkspaceCallbacks } from "./useGmailCallback.ts";

// History carries navigation provenance only. Shareable return destinations
// live in validated search parameters.
declare module "@tanstack/react-router" {
	interface HistoryState {
		overlayParent?: { index: number };
	}
}

export function createWorkspaceRouter(history?: RouterHistory) {
	const router = createRouter({
		routeTree,
		InnerWrap: WorkspaceCallbacks,
		parseSearch: parseWorkspaceSearch,
		// No JSON quoting for strings: copied links and generated links use
		// the same plain-string query contract.
		stringifySearch: stringifyWorkspaceSearch,
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
