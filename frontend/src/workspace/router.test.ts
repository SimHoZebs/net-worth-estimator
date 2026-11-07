import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWorkspaceRouter } from "./router.ts";

async function load(entry: string) {
	const router = createWorkspaceRouter(
		createMemoryHistory({ initialEntries: [entry] }),
	);
	await router.load();
	return router;
}

describe("workspace router", () => {
	it.each(["401", "0", "true", "false", "null"])(
		"preserves the account ID %s in the nested detail route",
		async (name) => {
			const router = await load(`/accounts/${encodeURIComponent(name)}`);
			const match = router.state.matches[router.state.matches.length - 1]!;
			expect(match.routeId).toBe("/accounts/$accountId");
			expect(match.params).toMatchObject({ accountId: name });
			expect(
				router.state.matches.find((item) => item.staticData.page)?.staticData
					.page,
			).toBe("accounts");
			const link = router.buildLocation({
				to: "/accounts/$accountId",
				params: { accountId: name },
			});
			const reloaded = await load(link.href);
			const reloadedMatch =
				reloaded.state.matches[reloaded.state.matches.length - 1]!;
			expect(reloadedMatch.routeId).toBe("/accounts/$accountId");
			expect(reloadedMatch.params).toMatchObject({ accountId: name });
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

	it("retains malformed overlay links for an explicit error", async () => {
		const router = await load(
			"/accounts?editor=account&id=a&id=b&gmail=connected",
		);
		expect(router.state.location.search).toEqual({
			editor: "account",
			id: ["a", "b"],
			gmail: "connected",
		});
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

	it("ordinary page navigation clears editor return context", async () => {
		const router = await load("/accounts");
		await router.navigate({
			to: "/accounts",
			search: { editor: "account", id: "new", returnEvidence: "position" },
		});
		expect(router.state.location.search.gmail).toBeUndefined();
		await router.navigate({ to: "/transactions" });
		expect(router.state.location.search.gmail).toBeUndefined();
		expect(router.state.location.search.returnEvidence).toBeUndefined();
	});
});
