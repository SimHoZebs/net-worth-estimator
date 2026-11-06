import { useMatches, useRouter, useRouterState } from "@tanstack/react-router";
import { isRecord } from "../domain/guards.ts";
import type { WorkspaceSearch } from "./overlaySearch.ts";
import type { Page, pagePaths } from "./navigation.ts";

/** Close undoes an in-app open. Direct loads replace the current entry with
 *  the explicit destination instead of leaving the app or adding history. */
export function useOverlayNavigation() {
	const router = useRouter();
	const matches = useMatches();
	const routeId = matches[matches.length - 1]?.routeId;
	const location = useRouterState({ select: (state) => state.location });

	const open = (
		search: WorkspaceSearch,
		options: { replace?: boolean; to?: (typeof pagePaths)[Page] } = {},
	) => {
		const { replace = false, to } = options;
		if (!routeId || routeId === "__root__") return;
		void router.navigate({
			from: routeId,
			to: to ?? ".",
			search,
			replace,
			resetScroll: to !== undefined,
			state: replace
				? location.state
				: {
						overlayParent: { index: location.state.__TSR_index },
					},
		});
	};
	const close = (fallback: WorkspaceSearch = {}) => {
		const parent: unknown = location.state.overlayParent;
		if (
			isRecord(parent) &&
			parent.index === location.state.__TSR_index - 1 &&
			location.state.__TSR_index > 0
		) {
			router.history.back();
			return;
		}
		void router.navigate({
			to: location.pathname,
			search: fallback,
			replace: true,
			resetScroll: false,
			state: {},
		});
	};
	return { open, close };
}
