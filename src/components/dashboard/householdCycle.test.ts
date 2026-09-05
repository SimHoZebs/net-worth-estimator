import { describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import {
	computeHouseholdCycle,
	DEFAULT_HOUSEHOLD_CYCLE_INPUTS,
	latestCheckingBalance,
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
