import { describe, expect, it } from "vitest";
import { createBasePack, makeAccount, makePosting } from "../__fixtures__";
import { prepareScenarioPack } from "../engine/prepareScenario";

describe("prepareScenarioPack", () => {
	it("applies all what-if collections without mutating the baseline", () => {
		const baseline = createBasePack();
		const prepared = prepareScenarioPack(baseline, {
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
});
