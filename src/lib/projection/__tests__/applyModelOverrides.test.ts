import { describe, expect, it } from "vitest";
import { createBaseDocument, makeAccount, makePosting } from "../__fixtures__";
import {
	applyModelOverrides,
	EMPTY_MODEL_OVERRIDES,
	prepareFinancialModelDocument,
} from "../model/applyModelOverrides";

describe("applyModelOverrides", () => {
	it("applies all override collections without mutating the baseline", () => {
		const baseline = createBaseDocument();
		const prepared = applyModelOverrides(baseline, {
			addedAccounts: [makeAccount({ id: "temporary" })],
			addedPostings: [makePosting({ id: "temporary-income" })],
			addedCheckpoints: [
				{ Date: "2026-02-01", AccountId: "temporary", Balance: 500 },
			],
			disabledAccountIds: ["loan"],
			disabledPostingIds: ["spend"],
		});

		expect(prepared.accounts.map((account) => account.id)).toContain(
			"temporary",
		);
		expect(prepared.accounts.map((account) => account.id)).not.toContain(
			"loan",
		);
		expect(prepared.postings.map((posting) => posting.id)).toContain(
			"temporary-income",
		);
		expect(prepared.postings.map((posting) => posting.id)).not.toContain(
			"spend",
		);
		expect(prepared.checkpoints).toContainEqual({
			Date: "2026-02-01",
			AccountId: "temporary",
			Balance: 500,
		});
		expect(
			prepared.checkpoints.some(
				(checkpoint) => checkpoint.AccountId === "loan",
			),
		).toBe(false);
		expect(baseline.accounts.map((account) => account.id)).toContain("loan");
		expect(baseline.checkpoints).toHaveLength(3);
	});

	it("prepares a document with empty overrides", () => {
		const document = createBaseDocument();

		expect(prepareFinancialModelDocument(document)).toEqual(document);
		expect(EMPTY_MODEL_OVERRIDES).toEqual({
			addedAccounts: [],
			addedPostings: [],
			addedCheckpoints: [],
			disabledAccountIds: [],
			disabledPostingIds: [],
		});
	});
});
