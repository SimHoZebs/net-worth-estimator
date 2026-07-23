import { describe, expect, it } from "vitest";
import {
	createBasePack,
	makeAccount,
	makePosting,
	makeSettings,
} from "../__fixtures__";
import { prepareSimulationRequest } from "../scenario/prepareSimulation";
import { simulate } from "../simulation/simulate";
import type { SimulationRequest } from "../types/simulation";

describe("simulation request preparation", () => {
	it("keeps checkpoint history outside the prepared kernel request", () => {
		const prepared = prepareSimulationRequest(createBasePack(), makeSettings());

		expect(prepared.historicalSnapshots).toEqual([
			{
				date: "2026-01-31",
				balances: { checking: 800, brokerage: 1200, loan: -400 },
			},
		]);
		expect(prepared.request).not.toHaveProperty("checkpoints");
		expect(prepared.request).not.toHaveProperty("evaluations");
		expect(prepared.request.startDate).toBe("2026-01-31");
		expect(prepared.request.includeStartDateEvents).toBe(false);
	});

	it("includes fallback start-date postings when no checkpoint exists", () => {
		const pack = createBasePack({
			checkpoints: [],
			accounts: [makeAccount({ id: "checking" })],
			postings: [
				makePosting({
					id: "start-date-income",
					destinations: ["checking"],
					arithmetic: "100",
					startDate: "2026-01-01",
					endDate: "2026-01-01",
				}),
			],
		});
		const prepared = prepareSimulationRequest(
			pack,
			makeSettings({ fallbackProjectionStartDate: "2026-01-01" }),
		);

		expect(prepared.request.includeStartDateEvents).toBe(true);
		expect(simulate(prepared.request).movementAttempts).toHaveLength(1);
	});
});

describe("deterministic simulation kernel", () => {
	it("inherits runtime state without mutating the request", () => {
		const request: SimulationRequest = {
			model: {
				accounts: [makeAccount({ id: "checking" })],
				postings: [
					makePosting({
						id: "capped-dependent",
						destinations: ["checking"],
						arithmetic: "base * 0.5",
						startDate: "2026-06-01",
						endDate: "2026-06-01",
						annualCap: 600,
					}),
				],
			},
			initialState: {
				balances: { checking: 50 },
				latestRealizedPostingAmounts: new Map([["base", 1000]]),
				realizedPostingAmountsByYear: new Map([
					["capped-dependent", new Map([["2026", 500]])],
				]),
			},
			startDate: "2026-05-01",
			endDate: "2026-12-31",
			includeStartDateEvents: true,
		};
		const originalState = structuredClone(request.initialState);

		const run = simulate(request);

		expect(run.movementAttempts[0]).toMatchObject({
			requestedAmount: 500,
			realizedAmount: 100,
		});
		expect(run.finalState.balances.checking).toBe(150);
		expect(
			run.finalState.latestRealizedPostingAmounts.get("capped-dependent"),
		).toBe(100);
		expect(request.initialState).toEqual(originalState);
	});

	it("records exact dated snapshots and fully blocked attempts", () => {
		const prepared = prepareSimulationRequest(
			createBasePack({
				checkpoints: [
					{ Date: "2026-01-01", AccountId: "checking", Balance: 100 },
				],
				accounts: [makeAccount({ id: "checking", minBalance: 100 })],
				postings: [
					makePosting({
						id: "blocked",
						sourceAccountId: "checking",
						arithmetic: "50",
						startDate: "2026-01-10",
						endDate: "2026-01-10",
					}),
				],
			}),
			makeSettings(),
		);

		const run = simulate(prepared.request);

		expect(run.snapshots).toHaveLength(1);
		expect(run.snapshots[0]).toMatchObject({
			date: "2026-01-10",
			balances: { checking: 100 },
		});
		expect(run.movementAttempts[0]).toMatchObject({
			realizedAmount: 0,
			bindingConstraints: [{ type: "source-floor", accountId: "checking" }],
			accountDeltas: [],
		});
	});
});
