import {
	createRootRoute,
	redirect,
	Link,
	ErrorComponent,
	retainSearchParams,
} from "@tanstack/react-router";
import { ServerApp } from "../app/ServerApp.tsx";
import {
	hasInvalidOverlaySearch,
	validateWorkspaceSearch,
	InvalidWorkspaceLinkError,
	isInvalidWorkspaceLink,
} from "../workspace/overlaySearch.ts";

export const Route = createRootRoute({
	component: ServerApp,
	search: {
		// Navigation stays available during session verification. Preserve
		// the callback only until the workspace can consume it safely.
		middlewares: [retainSearchParams(["gmail"])],
	},
	validateSearch: (search) => {
		// Use Router's search-error boundary. Returning an empty shape would
		// silently erase invalid input during initial canonicalization.
		if (hasInvalidOverlaySearch(search)) throw new InvalidWorkspaceLinkError();
		return validateWorkspaceSearch(search);
	},
	errorComponent: ({ error }) =>
		isInvalidWorkspaceLink(error) ? (
			<ServerApp invalidLink />
		) : (
			<ErrorComponent error={error} />
		),
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
	notFoundComponent: WorkspaceNotFound,
});

function WorkspaceNotFound() {
	return (
		<section
			aria-label="Page not found"
			className="grid justify-items-start gap-4 p-6"
		>
			<h2 className="text-2xl">Page not found</h2>
			<p>
				This link does not point to a workspace page. Check the address or
				choose a page from navigation.
			</p>
			<Link to="/outlook" className="text-primary underline">
				Go to Outlook
			</Link>
		</section>
	);
}
