import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { accountDeleteError, upsertItem } from "./accountEdits.ts";

describe("row edits", () => {
	it("upserts without touching unrelated rows", () => {
		const item = financialModelFixture.accounts[0];
		if (!item) throw new Error("Missing test account");
		const current = upsertItem({
			items: financialModelFixture.accounts,
			item: { ...item },
		});
		expect(current).toEqual(financialModelFixture.accounts);
		expect(current).not.toBe(financialModelFixture.accounts);
		const added = upsertItem({
			items: financialModelFixture.accounts,
			item: { ...item, id: "extra" },
		});
		expect(added).toHaveLength(financialModelFixture.accounts.length + 1);
		expect(financialModelFixture.accounts).toHaveLength(added.length - 1);
	});

	it("rejects referenced and last-account deletions", () => {
		expect(
			accountDeleteError({
				accounts: financialModelFixture.accounts,
				transactions: financialModelFixture.transactions,
				evaluations: financialModelFixture.evaluations,
				targetId: "checking",
			}),
		).toBeInstanceOf(Error);
		expect(
			accountDeleteError({
				accounts: financialModelFixture.accounts.slice(0, 1),
				transactions: [],
				evaluations: [],
				targetId: financialModelFixture.accounts[0]!.id,
			}),
		).toBeInstanceOf(Error);
	});

	it("allows deleting an unreferenced account", () => {
		expect(
			accountDeleteError({
				accounts: financialModelFixture.accounts,
				transactions: [],
				evaluations: [],
				targetId: "savings",
			}),
		).toBeNull();
	});
});
