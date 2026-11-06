import { act, cleanup, renderHook } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	retainSearchParams,
} from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays.ts";
import { validateWorkspaceSearch } from "./overlaySearch.ts";

vi.mock("../state/savedState.ts", () => ({
	useSavedAccounts: () => financialModelFixture.accounts,
	useSavedTransactions: () =>
		financialModelFixture.transactions.filter(
			(row) => row.kind === "transaction",
		),
	useSavedSchedules: () =>
		financialModelFixture.transactions
			.filter((row) => row.kind === "schedule")
			.map((row) => ({
				id: row.id,
				name: row.name,
				sourceAccountId: row.fromId,
				destinations: row.toId ? [row.toId] : null,
				amount: {
					resolver: "expression",
					config: { expression: String(row.amount) },
					inputs: {},
				},
				frequency: "monthly",
				startDate: row.startDate,
				endDate: row.endDate,
				annualCap: null,
				priority: 0,
				enabled: row.enabled,
			})),
	useSavedEvaluations: () => [],
}));

const rootRoute = createRootRoute({
	component: () => createElement(Outlet),
	validateSearch: validateWorkspaceSearch,
	search: { middlewares: [retainSearchParams(["gmail"])] },
});
const stub = createRoute({
	getParentRoute: () => rootRoute,
	path: "/$slug",
	component: () => null,
});
const accountsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/accounts",
	component: () => null,
});
const transactionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/transactions",
	component: () => null,
});
const routeTree = rootRoute.addChildren([
	accountsRoute,
	transactionsRoute,
	stub,
]);

async function useHarness(initialEntry = "/accounts") {
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
	});
	await router.load();
	const wrapper = ({ children }: { children: ReactNode }) => {
		rootRoute.update({ component: () => children });
		return createElement(RouterProvider, { router });
	};
	const hook = renderHook(() => useWorkspaceOverlays(), { wrapper });
	return { router, ...hook };
}

afterEach(() => {
	cleanup();
});

it("returns to the owning evidence after edit and clears context on an ordinary editor open", async () => {
	const account = financialModelFixture.accounts[0]!;
	const { router, result } = await useHarness();
	await act(async () =>
		result.current.openEvidence({
			kind: "account",
			id: account.id,
		}),
	);
	expect(router.state.location.search).toMatchObject({
		evidence: "account",
	});
	await act(async () =>
		result.current.editFromEvidence({
			kind: "account",
			item: account,
		}),
	);
	expect(result.current.editor?.kind).toBe("account");
	const state = router.state.location.state as { returnTo?: unknown };
	expect(state.returnTo).toEqual({
		kind: "account",
		id: account.id,
	});
	await act(async () => result.current.closeEditor());
	expect(result.current.evidence).toEqual({
		kind: "account",
		id: account.id,
	});
	expect(router.state.location.search).toMatchObject({ evidence: "account" });
	await act(async () =>
		result.current.openEditor({ kind: "account", item: null }),
	);
	await act(async () => result.current.closeEditor());
	expect(result.current.evidence).toBeNull();
	expect(router.state.location.pathname).toBe("/accounts");
	expect(router.state.location.search).toEqual({});
});

it("a page navigation cannot leak a previous editor's return target", async () => {
	const account = financialModelFixture.accounts[0]!;
	const { router, result } = await useHarness();
	await act(async () =>
		result.current.openEvidence({
			kind: "account",
			id: account.id,
		}),
	);
	await act(async () =>
		result.current.editFromEvidence({
			kind: "account",
			item: account,
		}),
	);
	await act(async () => {
		await router.navigate({ to: "/transactions" });
	});
	await act(async () =>
		result.current.openEditor({
			kind: "transaction",
			item: null,
		}),
	);
	await act(async () => result.current.closeEditor());
	expect(result.current.evidence).toBeNull();
	expect(router.state.location.pathname).toBe("/transactions");
	expect(router.state.location.search).toEqual({});
});
