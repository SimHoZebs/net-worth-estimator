import { describe, expect, it } from "vitest";
import { createBaseDocument, makeAccount, makePosting } from "../__fixtures__";
import {
	applyModelOverrides,
	EMPTY_MODEL_OVERRIDES,
} from "../model/applyModelOverrides";

describe("applyModelOverrides", () => {
	it("applies temporary accounts, postings, and disabled IDs immutably", () => {
		const document = createBaseDocument({
			checkpoints: [{ Date: "2026-01-31", AccountId: "loan", Balance: -400 }],
		});
		const prepared = applyModelOverrides(document, {
			addedAccounts: [makeAccount({ id: "savings" })],
			addedPostings: [
				makePosting({
					id: "savings-deposit",
					destinations: ["savings"],
				}),
			],
			disabledAccountIds: ["loan"],
			disabledPostingIds: ["spend"],
		});

		expect(prepared.accounts.map(({ id }) => id)).toContain("savings");
		expect(prepared.accounts.map(({ id }) => id)).not.toContain("loan");
		expect(prepared.postings.map(({ id }) => id)).toContain("savings-deposit");
		expect(prepared.postings.map(({ id }) => id)).not.toContain("spend");
		expect(prepared.checkpoints).toEqual([]);
		expect(document.accounts.map(({ id }) => id)).toContain("loan");
		expect(document.postings.map(({ id }) => id)).toContain("spend");
	});

	it("returns equivalent collections for empty overrides", () => {
		const document = createBaseDocument();
		expect(applyModelOverrides(document, EMPTY_MODEL_OVERRIDES)).toEqual(
			document,
		);
	});
});
