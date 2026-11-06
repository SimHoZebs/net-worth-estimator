import { render, waitFor } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { useOverlayNavigation } from "./useOverlayNavigation.ts";

function CrossPageEvidence() {
	const navigation = useOverlayNavigation();
	return (
		<>
			<button
				type="button"
				onClick={() =>
					navigation.open(
						{ evidence: "account", id: "checking" },
						{ to: "/accounts" },
					)
				}
			>
				Open account
			</button>
			<button type="button" onClick={() => navigation.close()}>
				Close overlay
			</button>
		</>
	);
}

it("closing evidence opened from another page undoes the cross-page open", async () => {
	const user = userEvent.setup();
	const root = createRootRoute({ component: CrossPageEvidence });
	const children = ["/accounts", "/evaluations"].map((path) =>
		createRoute({ getParentRoute: () => root, path, component: () => null }),
	);
	const router = createRouter({
		routeTree: root.addChildren(children),
		history: createMemoryHistory({ initialEntries: ["/evaluations"] }),
	});
	await router.load();
	const view = render(<RouterProvider router={router} />);
	await user.click(view.getByRole("button", { name: "Open account" }));
	await waitFor(() => expect(router.state.location.pathname).toBe("/accounts"));
	expect(router.state.location.search).toMatchObject({
		evidence: "account",
		id: "checking",
	});
	await user.click(view.getByRole("button", { name: "Close overlay" }));
	await waitFor(() =>
		expect(router.state.location.pathname).toBe("/evaluations"),
	);
});
