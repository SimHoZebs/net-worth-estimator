import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation.ts";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays.ts";

vi.mock("../state/savedRows.ts", () => ({
	useSavedAccounts: () => financialModelFixture.accounts,
	useSavedTransactions: () => financialModelFixture.transactions,
	useSavedEvaluations: () => [],
}));

beforeEach(() => window.history.replaceState(null, "", "#accounts"));
afterEach(() => {
	cleanup();
	window.history.replaceState(null, "", "#accounts");
});

function useHarness() {
	const navigation = useWorkspaceNavigation();
	return { navigation, overlays: useWorkspaceOverlays(navigation) };
}

it("returns to the owning evidence after edit and clears context on an ordinary editor open", () => {
	const account = financialModelFixture.accounts[0]!;
	const hook = renderHook(useHarness);
	act(() =>
		hook.result.current.overlays.openEvidence({
			kind: "account",
			id: account.id,
		}),
	);
	act(() =>
		hook.result.current.overlays.editFromEvidence({
			kind: "account",
			item: account,
		}),
	);
	expect(hook.result.current.overlays.editor?.kind).toBe("account");
	expect(hook.result.current.navigation.returnTo).toEqual({
		kind: "account",
		id: account.id,
	});
	act(() => hook.result.current.overlays.closeEditor());
	expect(hook.result.current.overlays.evidence).toEqual({
		kind: "account",
		id: account.id,
	});
	expect(hook.result.current.navigation.returnTo).toBeNull();
	act(() =>
		hook.result.current.overlays.openEditor({ kind: "account", item: null }),
	);
	act(() => hook.result.current.overlays.closeEditor());
	expect(hook.result.current.overlays.evidence).toBeNull();
	expect(window.location.hash).toBe("#accounts");
});

it("a page navigation cannot leak a previous editor's return target", () => {
	const account = financialModelFixture.accounts[0]!;
	const hook = renderHook(useHarness);
	act(() =>
		hook.result.current.overlays.openEvidence({
			kind: "account",
			id: account.id,
		}),
	);
	act(() =>
		hook.result.current.overlays.editFromEvidence({
			kind: "account",
			item: account,
		}),
	);
	act(() => hook.result.current.navigation.navigate("transactions"));
	expect(hook.result.current.navigation.returnTo).toBeNull();
	act(() =>
		hook.result.current.overlays.openEditor({
			kind: "transaction",
			item: null,
		}),
	);
	act(() => hook.result.current.overlays.closeEditor());
	expect(hook.result.current.overlays.evidence).toBeNull();
	expect(window.location.hash).toBe("#transactions");
});
