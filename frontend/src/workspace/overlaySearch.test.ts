import { describe, expect, test } from "vitest";
import {
	validateWorkspaceSearch,
	type WorkspaceSearch,
} from "./overlaySearch.ts";

const empty: WorkspaceSearch = {
	evidence: undefined,
	editor: undefined,
	detail: undefined,
	id: undefined,
	tab: undefined,
	editTransaction: undefined,
	gmail: undefined,
};

describe("validateWorkspaceSearch", () => {
	test("empty search validates to no overlay", () => {
		expect(validateWorkspaceSearch({})).toEqual(empty);
	});

	test("evidence variants validate", () => {
		expect(validateWorkspaceSearch({ evidence: "position" })).toEqual({
			...empty,
			evidence: "position",
		});
		expect(validateWorkspaceSearch({ evidence: "shortfall" })).toEqual({
			...empty,
			evidence: "shortfall",
		});
		expect(validateWorkspaceSearch({ evidence: "safe-spending" })).toEqual({
			...empty,
			evidence: "safe-spending",
		});
		expect(
			validateWorkspaceSearch({ evidence: "account", id: "checking" }),
		).toEqual({ ...empty, evidence: "account", id: "checking" });
	});

	test("editor variants validate", () => {
		expect(validateWorkspaceSearch({ editor: "account", id: "new" })).toEqual({
			...empty,
			editor: "account",
			id: "new",
		});
		expect(
			validateWorkspaceSearch({ editor: "transaction", id: "invest" }),
		).toEqual({ ...empty, editor: "transaction", id: "invest" });
		expect(validateWorkspaceSearch({ editor: "schedule", id: "new" })).toEqual({
			...empty,
			editor: "schedule",
			id: "new",
		});
		expect(
			validateWorkspaceSearch({ editor: "evaluation", id: "goal-1" }),
		).toEqual({ ...empty, editor: "evaluation", id: "goal-1" });
	});

	test("safe spending detail validates with tab default handled downstream", () => {
		expect(validateWorkspaceSearch({ detail: "safe-spending" })).toEqual({
			...empty,
			detail: "safe-spending",
		});
		expect(
			validateWorkspaceSearch({ detail: "safe-spending", tab: "cycle" }),
		).toEqual({ ...empty, detail: "safe-spending", tab: "cycle" });
		expect(
			validateWorkspaceSearch({
				detail: "safe-spending",
				tab: "last-cycle",
			}),
		).toEqual({ ...empty, detail: "safe-spending", tab: "last-cycle" });
		expect(
			validateWorkspaceSearch({
				detail: "safe-spending",
				tab: "cycle",
				editTransaction: "invest",
			}),
		).toEqual({
			...empty,
			detail: "safe-spending",
			tab: "cycle",
			editTransaction: "invest",
		});
		expect(
			validateWorkspaceSearch({
				detail: "safe-spending",
				tab: "configure",
			}),
		).toEqual({ ...empty, detail: "safe-spending", tab: "configure" });
	});

	test("gmail flag validates and survives otherwise valid overlays", () => {
		expect(validateWorkspaceSearch({ gmail: "connected" })).toEqual({
			...empty,
			gmail: "connected",
		});
		expect(
			validateWorkspaceSearch({ editor: "account", id: "new", gmail: "error" }),
		).toEqual({ ...empty, editor: "account", id: "new", gmail: "error" });
	});

	test("unrelated params are dropped, overlay params unaffected", () => {
		expect(
			validateWorkspaceSearch({ editor: "account", id: "new", foo: "bar" }),
		).toEqual({ ...empty, editor: "account", id: "new" });
	});

	test("an unknown gmail value cannot poison the overlay", () => {
		expect(
			validateWorkspaceSearch({ editor: "account", id: "new", gmail: "bogus" }),
		).toEqual({ ...empty });
	});

	test("duplicate params (arrays) drop the overlay and keep gmail", () => {
		expect(
			validateWorkspaceSearch({ evidence: "account", id: ["a", "b"] }),
		).toEqual(empty);
		expect(
			validateWorkspaceSearch({
				evidence: "account",
				id: ["a", "b"],
				gmail: "connected",
			}),
		).toEqual({ ...empty, gmail: "connected" });
	});

	test("malformed overlays validate to no overlay, never partially", () => {
		const cases: Record<string, unknown>[] = [
			{ evidence: "account" },
			{ editor: "transaction" },
			{ id: "checking" },
			{ tab: "cycle" },
			{ editTransaction: "invest" },
			{ evidence: "position", editor: "transaction", id: "invest" },
			{ evidence: "bogus" },
			{ editor: "bogus", id: "x" },
			{ detail: "bogus" },
			{ detail: "safe-spending", tab: "bogus" },
			{ detail: "safe-spending", editor: "account", id: "new" },
			{ evidence: "account", id: 42 },
		];
		for (const raw of cases) {
			expect(validateWorkspaceSearch(raw)).toEqual(empty);
		}
	});

	test("malformed overlays keep the gmail flag so normalization preserves it", () => {
		expect(
			validateWorkspaceSearch({
				evidence: "position",
				editor: "transaction",
				id: "invest",
				gmail: "connected",
			}),
		).toEqual({ ...empty, gmail: "connected" });
	});

	test("a stray id beside a no-id evidence kind is inert, never invalid", () => {
		// Evidence position/shortfall/safe-spending carry no id; a stray id
		// beside them is ignored by the resolver, matching the old parser.
		expect(
			validateWorkspaceSearch({ evidence: "position", id: "checking" }),
		).toEqual({ ...empty, evidence: "position", id: "checking" });
	});
});
