import { describe, expect, test } from "vitest";
import { SearchParamError } from "@tanstack/react-router";
import {
	validateWorkspaceSearch,
	hasInvalidOverlaySearch,
	parseWorkspaceSearch,
	stringifyWorkspaceSearch,
	InvalidWorkspaceLinkError,
	isInvalidWorkspaceLink,
	type WorkspaceSearch,
} from "./overlaySearch.ts";

const empty: WorkspaceSearch = {
	evidence: undefined,
	editor: undefined,
	detail: undefined,
	id: undefined,
	tab: undefined,
	editTransaction: undefined,
	returnEvidence: undefined,
	returnId: undefined,
	gmail: undefined,
};

describe("validateWorkspaceSearch", () => {
	test("expected invalid-link errors are distinct from application failures", () => {
		expect(
			isInvalidWorkspaceLink(
				new SearchParamError("Invalid workspace link", {
					cause: new InvalidWorkspaceLinkError(),
				}),
			),
		).toBe(true);
		expect(isInvalidWorkspaceLink(new Error("Invalid workspace link"))).toBe(
			false,
		);
		expect(
			isInvalidWorkspaceLink(
				new SearchParamError("Unexpected validator failure"),
			),
		).toBe(false);
	});
	test("editor return destinations are shareable, typed and limited to evidence", () => {
		expect(
			validateWorkspaceSearch({
				editor: "transaction",
				id: "new",
				returnEvidence: "position",
			}),
		).toEqual({
			...empty,
			editor: "transaction",
			id: "new",
			returnEvidence: "position",
		});
		for (const search of [
			{ returnEvidence: "position" },
			{
				editor: "account",
				id: "new",
				returnEvidence: "position",
				returnId: "checking",
			},
			{ editor: "account", id: "new", returnId: "checking" },
			{
				editor: "account",
				id: "new",
				returnEvidence: "shortfall",
				returnId: "checking",
			},
		])
			expect(validateWorkspaceSearch(search)).toEqual(empty);
	});
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
		).toEqual({ ...empty, editor: "account", id: "new" });
	});

	test("duplicate params (arrays) drop the overlay and keep gmail", () => {
		expect(
			validateWorkspaceSearch({ editor: "account", id: ["a", "b"] }),
		).toEqual(empty);
		expect(
			validateWorkspaceSearch({
				editor: "account",
				id: ["a", "b"],
				gmail: "connected",
			}),
		).toEqual({ ...empty, gmail: "connected" });
	});

	test("malformed overlays validate to no overlay, never partially", () => {
		const cases: Record<string, unknown>[] = [
			{ evidence: "position", id: "checking" },
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
			{ editor: "account", id: 42 },
		];
		for (const raw of cases) {
			expect(validateWorkspaceSearch(raw)).toEqual(empty);
		}
	});

	test("invalid overlay input does not hide a callback result from the workspace", () => {
		expect(
			validateWorkspaceSearch({
				evidence: "position",
				editor: "transaction",
				id: "invest",
				gmail: "connected",
			}),
		).toEqual({ ...empty, gmail: "connected" });
	});

	test("parameters must belong to the selected overlay", () => {
		for (const search of [
			{ evidence: "position", id: "checking" },
			{ evidence: "position", tab: "cycle" },
			{ editor: "account", id: "new", editTransaction: "invest" },
			{ detail: "safe-spending", id: "checking" },
			{ editor: "account", id: "" },
			{ detail: "safe-spending", editTransaction: "" },
		]) {
			expect(validateWorkspaceSearch(search)).toEqual(empty);
			expect(hasInvalidOverlaySearch(search)).toBe(true);
		}
	});

	test("query serialization preserves duplicate input for an explicit link error", () => {
		const raw = "?editor=account&id=a&id=b&gmail=error";
		const parsed = parseWorkspaceSearch(raw);
		expect(stringifyWorkspaceSearch(parsed)).toBe(raw);
		expect(hasInvalidOverlaySearch(parsed)).toBe(true);
	});
});
