import { act, render, waitFor } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	retainSearchParams,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { setupQueryScope, teardownQueryScope } from "../mocks/testScope.tsx";
import { acceptTestResource } from "../mocks/resource.ts";
import { suspendUserScope } from "../auth/resourceScope.ts";
import { gmailCredentialKey } from "../state/gmail.ts";
import { integrationsKey } from "../state/integrations.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import {
	parseWorkspaceSearch,
	stringifyWorkspaceSearch,
	validateWorkspaceSearch,
} from "./overlaySearch.ts";
import { WorkspaceCallbacks } from "./useGmailCallback.ts";

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
	Toaster: () => null,
}));

beforeEach(() => {
	setupQueryScope();
	vi.clearAllMocks();
});
afterEach(() => {
	teardownQueryScope();
	vi.clearAllMocks();
});

async function renderCallback(entry: string) {
	function Workspace() {
		return <NotificationCenter />;
	}
	const root = createRootRoute({
		component: Workspace,
		validateSearch: validateWorkspaceSearch,
		search: { middlewares: [retainSearchParams(["gmail"])] },
	});
	const pages = ["/accounts", "/transactions"].map((path) =>
		createRoute({ getParentRoute: () => root, path, component: () => null }),
	);
	const router = createRouter({
		InnerWrap: WorkspaceCallbacks,
		routeTree: root.addChildren(pages),
		history: createMemoryHistory({ initialEntries: [entry] }),
		parseSearch: parseWorkspaceSearch,
		stringifySearch: stringifyWorkspaceSearch,
	});
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

it("consumes a successful callback on Accounts and invalidates inactive caches without fetching them", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	const cache = serverQueryClient();
	cache.setQueryData(gmailCredentialKey(), { connected: false });
	cache.setQueryData(integrationsKey(), []);
	const router = await renderCallback(
		"/accounts?editor=account&id=new&returnEvidence=position&gmail=connected",
	);
	await waitFor(() =>
		expect(toast.success).toHaveBeenCalledWith(
			"Gmail connected.",
			expect.objectContaining({ id: "gmail-callback" }),
		),
	);
	await waitFor(() =>
		expect(router.state.location.search.gmail).toBeUndefined(),
	);
	expect(router.state.location.search).toMatchObject({
		editor: "account",
		id: "new",
		returnEvidence: "position",
	});
	expect(cache.getQueryState(gmailCredentialKey())?.isInvalidated).toBe(true);
	expect(cache.getQueryState(integrationsKey())?.isInvalidated).toBe(true);
	expect(fetcher).not.toHaveBeenCalled();
	await act(async () => {
		await router.navigate({ to: "/transactions" });
	});
	expect(toast.success).toHaveBeenCalledTimes(1);
});

it("reports a failed callback once and preserves invalid dialog input for its error state", async () => {
	const router = await renderCallback(
		"/accounts?editor=account&id=a&id=b&gmail=error",
	);
	await waitFor(() =>
		expect(toast.error).toHaveBeenCalledWith(
			"Gmail connection failed. Try connecting again.",
			expect.objectContaining({ id: "gmail-callback" }),
		),
	);
	await waitFor(() =>
		expect(router.state.location.search.gmail).toBeUndefined(),
	);
	expect(router.state.location.search.id).toEqual(["a", "b"]);
	expect(toast.error).toHaveBeenCalledTimes(1);
});

it("retains the callback through navigation during scope verification, then consumes it once", async () => {
	suspendUserScope();
	const router = await renderCallback("/accounts?gmail=connected");
	expect(toast.success).not.toHaveBeenCalled();
	expect(router.state.location.search.gmail).toBe("connected");
	await act(async () => {
		await router.navigate({ to: "/transactions" });
	});
	expect(router.state.location.search.gmail).toBe("connected");
	expect(toast.success).not.toHaveBeenCalled();
	await act(async () => {
		acceptTestResource();
		serverQueryClient().setQueryData(gmailCredentialKey(), {
			connected: false,
		});
		serverQueryClient().setQueryData(integrationsKey(), []);
	});
	await waitFor(() =>
		expect(toast.success).toHaveBeenCalledWith(
			"Gmail connected.",
			expect.objectContaining({ id: "gmail-callback" }),
		),
	);
	await waitFor(() =>
		expect(router.state.location.search.gmail).toBeUndefined(),
	);
	expect(router.state.location.pathname).toBe("/transactions");
	expect(toast.success).toHaveBeenCalledTimes(1);
	expect(
		serverQueryClient().getQueryState(gmailCredentialKey())?.isInvalidated,
	).toBe(true);
	expect(
		serverQueryClient().getQueryState(integrationsKey())?.isInvalidated,
	).toBe(true);
	vi.clearAllMocks();
	serverQueryClient().setQueryData(gmailCredentialKey(), { connected: true });
	serverQueryClient().setQueryData(integrationsKey(), []);
	await act(async () => {
		router.history.back();
	});
	await waitFor(() => expect(router.state.location.pathname).toBe("/accounts"));
	await waitFor(() =>
		expect(router.state.location.search.gmail).toBeUndefined(),
	);
	expect(toast.success).not.toHaveBeenCalled();
	expect(
		serverQueryClient().getQueryState(gmailCredentialKey())?.isInvalidated,
	).toBe(false);
	expect(
		serverQueryClient().getQueryState(integrationsKey())?.isInvalidated,
	).toBe(false);
});
