import { describe, expect, it } from "vitest";
import { describeAllowance } from "./allowanceView.ts";

describe("describeAllowance", () => {
	it("keeps a positive allowance as the safe primary", () => {
		expect(
			describeAllowance({
				allowance: 300,
				theoretical: 500,
				reserve: 200,
				available: true,
			}),
		).toEqual({
			phase: "safe",
			primary: 300,
			tone: "positive",
			intoReserve: 0,
			overLimit: 0,
		});
	});

	it("shows the hard-limit remainder while into reserve", () => {
		expect(
			describeAllowance({
				allowance: -692,
				theoretical: 33,
				reserve: 725,
				available: true,
			}),
		).toEqual({
			phase: "into-reserve",
			primary: 33,
			tone: "normal",
			intoReserve: 692,
			overLimit: 0,
		});
	});

	it("caps the primary at zero once over the hard limit", () => {
		expect(
			describeAllowance({
				allowance: -7975,
				theoretical: -7250,
				reserve: 725,
				available: true,
			}),
		).toEqual({
			phase: "over-limit",
			primary: 0,
			tone: "negative",
			intoReserve: 725,
			overLimit: 7250,
		});
	});

	it("states nothing when the closed balance is missing", () => {
		expect(
			describeAllowance({
				allowance: 0,
				theoretical: 0,
				reserve: 725,
				available: false,
			}),
		).toEqual({
			phase: "unavailable",
			primary: null,
			tone: "normal",
			intoReserve: 0,
			overLimit: 0,
		});
	});

	it("treats zero as the safe and into-reserve boundaries", () => {
		expect(
			describeAllowance({
				allowance: 0,
				theoretical: 725,
				reserve: 725,
				available: true,
			}).phase,
		).toBe("safe");
		expect(
			describeAllowance({
				allowance: -725,
				theoretical: 0,
				reserve: 725,
				available: true,
			}),
		).toEqual({
			phase: "into-reserve",
			primary: 0,
			tone: "normal",
			intoReserve: 725,
			overLimit: 0,
		});
	});
});
