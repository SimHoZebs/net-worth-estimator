import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		// The root path is the outlook landing page. Canonicalize it once
		// so bookmarks and direct loads share the `/outlook` URL.
		throw redirect({
			to: "/outlook",
			search: (prev) => prev,
			replace: true,
		});
	},
});
