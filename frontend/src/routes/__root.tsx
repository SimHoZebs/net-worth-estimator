import {
	createRootRoute,
	redirect,
	retainSearchParams,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { ServerApp } from "../app/ServerApp.tsx";
import { validateWorkspaceSearch } from "../workspace/overlaySearch.ts";

export const Route = createRootRoute({
	component: ServerApp,
	validateSearch: validateWorkspaceSearch,
	beforeLoad: ({ location }) => {
		const canonicalSearch = validateWorkspaceSearch(location.search);
		// Validation owns both the rendered state and the canonical URL.
		// Invalid and unrelated input must not linger in copied deep links.
		if (
			Object.entries(location.search).some(
				([key, value]) =>
					value !== canonicalSearch[key as keyof typeof canonicalSearch],
			)
		) {
			throw redirect({
				to: location.pathname,
				search: canonicalSearch,
				replace: true,
			});
		}
	},
	search: {
		// The OAuth callback flag rides every navigation until the Gmail
		// panel consumes it.
		middlewares: [retainSearchParams(["gmail"])],
	},
	notFoundComponent: NotFoundRedirect,
});

// Unknown pages fall back to outlook instead of a blank screen; overlay
// params normalize away there through validated search.
function NotFoundRedirect() {
	const navigate = useNavigate();
	const gmail = useSearch({ strict: false, select: (search) => search.gmail });
	useEffect(() => {
		void navigate({
			to: "/outlook",
			search: { gmail },
			replace: true,
		});
	}, [navigate, gmail]);
	return null;
}
