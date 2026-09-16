import { describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import {
	classifySyncAccount,
	computeHouseholdCycle,
	DEFAULT_HOUSEHOLD_CYCLE_INPUTS,
	latestCheckingBalance,
	latestSyncBalance,
	seedExposureFromSync,
} from "./householdCycle";

describe("computeHouseholdCycle", () => {
	it("returns $0 across the board for default inputs", () => {
		const result = computeHouseholdCycle(DEFAULT_HOUSEHOLD_CYCLE_INPUTS);
		expect(result).toEqual({
			cashCushion: 0,
			currentCycleCommitted: 0,
			theoreticalRoom: 0,
			conservativeRoom: -725,
		});
	});

	it("keeps cash cushion and card-cycle capacity separate", () => {
		const result = computeHouseholdCycle({
			...DEFAULT_HOUSEHOLD_CYCLE_INPUTS,
			checkingBalance: 2000,
			unpaidCashObligations: 500,
			primeExposure: 400,
			ultimateExposure: 300,
			wifeCurrentCycle: 300,
			expectedPaycheck: 5000,
			nextMonthFixedObligations: 2500,
		});
		// Cash lane ignores card exposure; card lane ignores checking.
		expect(result.cashCushion).toBe(1500);
		expect(result.currentCycleCommitted).toBe(1000);
		expect(result.theoreticalRoom).toBe(1500);
		expect(result.conservativeRoom).toBe(775);
	});
});

describe("latestCheckingBalance", () => {
	it("returns null when no checking checkpoint exists", () => {
		expect(latestCheckingBalance(createBaseDocument())).toBeNull();
	});

	it("returns the latest checking checkpoint balance", () => {
		const document = createBaseDocument({
			accounts: [makeAccount({ id: "checking" })],
			checkpoints: [
				{ Date: "2026-07-01", AccountId: "checking", Balance: 100 },
				{ Date: "2026-07-27", AccountId: "checking", Balance: 397.74 },
			],
		});
		expect(latestCheckingBalance(document)).toBe(397.74);
	});
});

function syncPendingPosting(
	id: string,
	sourceAccountId: string,
	arithmetic: string,
	source: string | null = "simplefin",
	enabled = false,
) {
	return makePosting({
		id,
		label: id,
		sourceAccountId,
		destinations: null,
		arithmetic,
		frequency: "once",
		startDate: "2026-08-02",
		enabled,
		...(source === null ? {} : { source }),
	});
}

describe("seedExposureFromSync", () => {
	it("sums disabled sync pending rows per card slot", () => {
		const document = createBaseDocument({
			accounts: [
				makeAccount({ id: "prime_card", label: "Prime" }),
				makeAccount({ id: "ultimate_card", label: "Ultimate" }),
				makeAccount({ id: "mystery_card", label: "Mystery" }),
			],
			postings: [
				syncPendingPosting("sfin-pending-prime_card-a", "prime_card", "42.10"),
				syncPendingPosting("sfin-pending-prime_card-b", "prime_card", "7.90"),
				syncPendingPosting(
					"sfin-pending-ultimate_card-a",
					"ultimate_card",
					"100",
				),
				syncPendingPosting("sfin-pending-mystery_card-a", "mystery_card", "25"),
				// Owner rows, enabled rows, and non-pending ids never seed.
				syncPendingPosting(
					"sfin-pending-prime_card-enabled",
					"prime_card",
					"1000",
					"simplefin",
					true,
				),
				syncPendingPosting("owner-charge", "prime_card", "1000", null, false),
				{
					...syncPendingPosting(
						"sfin-posted-prime_card-a",
						"prime_card",
						"1000",
					),
				},
			],
		});
		const seed = seedExposureFromSync(document);
		expect(seed.prime).toBeCloseTo(50, 5);
		expect(seed.ultimate).toBe(100);
		expect(seed.wife).toBe(0);
		expect(seed.unclassified).toHaveLength(1);
		expect(seed.unclassified[0]?.accountId).toBe("mystery_card");
	});

	it("classifies by id or label", () => {
		expect(classifySyncAccount("prime_card", null)).toBe("prime");
		expect(classifySyncAccount("x", "Ultimate Card")).toBe("ultimate");
		expect(classifySyncAccount("x", "Wife Card")).toBe("wife");
		expect(classifySyncAccount("checking", "Checking")).toBeNull();
	});
});

describe("latestSyncBalance", () => {
	it("returns null without sync checkpoints", () => {
		expect(latestSyncBalance(createBaseDocument(), "2026-08-05")).toBeNull();
	});

	it("reports the latest sync date and age", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-08-01", AccountId: "checking", Balance: 1 },
				{
					Date: "2026-08-03",
					AccountId: "checking",
					Balance: 2,
					source: "simplefin",
				},
				{
					Date: "2026-08-02",
					AccountId: "prime_card",
					Balance: -3,
					source: "simplefin",
				},
			],
		});
		expect(latestSyncBalance(document, "2026-08-05")).toEqual({
			date: "2026-08-03",
			syncedAccounts: 2,
			ageDays: 2,
		});
	});
});
