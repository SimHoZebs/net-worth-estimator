import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWorkspaceRouter } from "./router.ts";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { evidenceSearch, resolveOverlay } from "./overlay.ts";

async function load(entry: string) {
	const router = createWorkspaceRouter(
		createMemoryHistory({ initialEntries: [entry] }),
	);
	await router.load();
	return router;
}

describe("workspace router", () => {
	it.each(["401", "0", "true", "false", "null"])(
		"preserves the account slug %s in direct and generated links",
		async (name) => {
			const account = {
				...financialModelFixture.accounts[0]!,
				id: "account-id",
				name,
			};
			const rows = { accounts: [account], transactions: [], evaluations: [] };
			const router = await load(`/accounts?evidence=account&id=${name}`);
			const expected = {
				state: "ready",
				overlay: {
					kind: "evidence",
					target: { kind: "account", id: account.id },
				},
			};
			expect(router.state.location.search.id).toBe(name);
			expect(resolveOverlay(router.state.location.search, rows)).toEqual(
				expected,
			);
			const link = router.buildLocation({
				to: "/accounts",
				search: evidenceSearch({ kind: "account", id: account.id }, rows),
			});
			const reloaded = await load(link.href);
			expect(reloaded.state.location.search.id).toBe(name);
			expect(resolveOverlay(reloaded.state.location.search, rows)).toEqual(
				expected,
			);
		},
	);
	it("matches group parameters through the nested route", async () => {
		const router = await load("/groups/household%20one");
		const match = router.state.matches[router.state.matches.length - 1]!;
		expect(match.routeId).toBe("/groups/$groupId");
		expect(match.params).toMatchObject({ groupId: "household one" });
		expect(
			router.state.matches.find((item) => item.staticData.page)?.staticData
				.page,
		).toBe("groups");
	});

	it("canonicalizes root while preserving validated search", async () => {
		const router = await load("/?evidence=position&gmail=connected");
		expect(router.state.location.pathname).toBe("/outlook");
		expect(router.state.location.search).toMatchObject({
			evidence: "position",
			gmail: "connected",
		});
	});

	it("removes duplicate overlay parameters before rendering", async () => {
		const router = await load(
			"/accounts?evidence=account&id=a&id=b&gmail=connected",
		);
		expect(router.state.location.search).toEqual({ gmail: "connected" });
	});

	it("removes unrelated search without discarding a valid overlay", async () => {
		const router = await load(
			"/accounts?editor=account&id=new&unrelated=value",
		);
		expect(router.state.location.search).toEqual({
			editor: "account",
			id: "new",
		});
	});

	it("retains Gmail until explicitly consumed and starts ordinary navigation without return context", async () => {
		const router = await load("/accounts?gmail=error");
		await router.navigate({
			to: "/accounts",
			search: { editor: "account", id: "new" },
			state: { returnTo: { kind: "position" } },
		});
		expect(router.state.location.search.gmail).toBe("error");
		await router.navigate({ to: "/transactions" });
		expect(router.state.location.search.gmail).toBe("error");
		expect(router.state.location.state.returnTo).toBeUndefined();
		await router.navigate({
			to: "/sources",
			search: { gmail: undefined },
			replace: true,
		});
		expect(router.state.location.search.gmail).toBeUndefined();
	});
});
