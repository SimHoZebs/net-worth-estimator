import { describe, expect, it } from "vitest";

import { claimOccurrenceCandidates } from "./ruleSchedule.ts";

describe("claimOccurrenceCandidates", () => {
	const occurrences = ["2026-09-01", "2026-10-01", "2026-11-01"];

	it("sorts server dates by distance to the posted day", () => {
		expect(
			claimOccurrenceCandidates({
				occurrences,
				postedRef: "2026-10-20",
				claimed: new Set(),
			}),
		).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
	});

	it("excludes dates another row already claimed", () => {
		expect(
			claimOccurrenceCandidates({
				occurrences,
				postedRef: "2026-10-20",
				claimed: new Set(["2026-10-01"]),
			}),
		).toEqual(["2026-11-01", "2026-09-01"]);
	});

	it("retains the row's own date at the front", () => {
		expect(
			claimOccurrenceCandidates({
				occurrences: ["2026-11-01", "2026-09-01"],
				postedRef: "2026-10-20",
				claimed: new Set(["2026-10-01"]),
				ownDate: "2026-10-01",
			}),
		).toEqual(["2026-10-01", "2026-11-01", "2026-09-01"]);
	});
});
