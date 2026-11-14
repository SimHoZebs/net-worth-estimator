import {
	createElement,
	Fragment,
	useEffect,
	useRef,
	type ReactNode,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useUserScope } from "../state/useUserScope.ts";
import { gmailCredentialKey } from "../state/gmail.ts";
import { integrationsKey } from "../state/integrations.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import { notifyError, notifySuccess } from "../state/notifications.ts";

/** One callback owner for the router runtime, outside route/error remounts. */
export function WorkspaceCallbacks({ children }: { children: ReactNode }) {
	useGmailCallback();
	return createElement(Fragment, null, children);
}

/** OAuth results belong to the workspace, not to a provider panel that may
 *  never mount. Consume the flag in place once the resource scope is ready. */
export function useGmailCallback() {
	const router = useRouter();
	const location = useRouterState({ select: (state) => state.location });
	const scope = useUserScope();
	const consumed = useRef(false);
	useEffect(() => {
		const outcome = location.search.gmail;
		if (
			scope.status !== "ready" ||
			(outcome !== "connected" && outcome !== "error")
		)
			return;
		const url = new URL(location.href, window.location.href);
		url.searchParams.delete("gmail");
		// Remove only this flag. Typed navigation reconstructs validated
		// search and would erase malformed input before its error is shown.
		router.history.replace(
			`${url.pathname}${url.search}${url.hash}`,
			location.state,
		);
		// A real consent round trip reloads the document. Within this router
		// runtime, repeated flags are stale copies in browser history. Clean
		// every copy, but announce and invalidate once, including after Back.
		if (consumed.current) return;
		consumed.current = true;
		if (outcome === "connected")
			notifySuccess("gmail-callback", "Gmail connected.");
		else
			notifyError(
				"gmail-callback",
				"Gmail connection failed. Try connecting again.",
			);
		// Refresh active provider panels, or mark their caches stale for the
		// next visit. An unrelated page must not fetch provider settings.
		const cache = serverQueryClient();
		void cache.invalidateQueries({ queryKey: gmailCredentialKey(scope) });
		void cache.invalidateQueries({ queryKey: integrationsKey(scope) });
	}, [location, router, scope]);
}
