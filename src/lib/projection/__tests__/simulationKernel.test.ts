import { describe, expect, it } from "vitest";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "../__fixtures__";
import { prepareSimulationRequest } from "../simulation/prepareSimulation";
import { simulate } from "../simulation/simulate";
import type { SimulationRequest } from "../types/simulation";

describe("simulation request preparation", () => {
	it("replays historical once postings outside the prepared kernel request", () => {
		const prepared = prepareSimulationRequest(
			createBaseDocument(),
			makeSettings(),
		);

		expect(prepared.historicalSnapshots).toEqual([
			{
				date: "2026-01-31",
				balances: { checking: 800, brokerage: 1200, loan: -400 },
			},
		]);
		expect(prepared.request).not.toHaveProperty("evaluations");
		expect(prepared.request.startDate).toBe("2026-02-01");
		expect(prepared.request.includeStartDateEvents).toBe(true);
		expect(prepared.request.initialState.balances).toEqual({
			checking: 800,
			brokerage: 1200,
			loan: -400,
		});
	});

	it("includes once postings on and after the fallback start date", () => {
		const document = createBaseDocument({
			accounts: [makeAccount({ id: "checking" })],
			postings: [
				makePosting({
					id: "start-date-income",
					destinations: ["checking"],
					arithmetic: "100",
					frequency: "once",
					startDate: "2026-01-01",
				}),
				makePosting({
					id: "future-income",
					destinations: ["checking"],
					arithmetic: "50",
					frequency: "once",
					startDate: "2026-01-02",
				}),
			],
		});
		const prepared = prepareSimulationRequest(
			document,
			makeSettings({ fallbackProjectionStartDate: "2026-01-01" }),
		);

		expect(prepared.request.includeStartDateEvents).toBe(true);
		expect(simulate(prepared.request).movementAttempts).toHaveLength(2);
	});

	it("replays only enabled once postings in date, priority, and document order", () => {
		const account = makeAccount({ id: "checking" });
		const document = createBaseDocument({
			accounts: [account],
			postings: [
				makePosting({
					id: "second",
					destinations: [account.id],
					arithmetic: "first * 2",
					frequency: "once",
					startDate: "2026-01-02",
					priority: 2,
					annualCap: 100,
				}),
				makePosting({
					id: "first",
					destinations: [account.id],
					arithmetic: "25",
					frequency: "once",
					startDate: "2026-01-02",
					priority: 1,
					volatility: 1,
					annualCap: 100,
				}),
				makePosting({
					id: "past-recurring",
					destinations: [account.id],
					arithmetic: "1000",
					startDate: "2026-01-01",
				}),
				makePosting({
					id: "disabled",
					destinations: [account.id],
					arithmetic: "1000",
					frequency: "once",
					startDate: "2026-01-01",
					enabled: false,
				}),
			],
		});

		const prepared = prepareSimulationRequest(
			document,
			makeSettings({ fallbackProjectionStartDate: "2026-02-01" }),
			undefined,
			{ annualRatesByPostingId: new Map([["first", [10]]]) },
		);

		expect(prepared.historicalSnapshots).toEqual([
			{ date: "2026-01-02", balances: { checking: 75 } },
		]);
		expect(prepared.request.initialState.latestRealizedPostingAmounts).toEqual(
			new Map([
				["first", 25],
				["second", 50],
			]),
		);
		expect(prepared.request.initialState.realizedPostingAmountsByYear).toEqual(
			new Map([
				["first", new Map([["2026", 25]])],
				["second", new Map([["2026", 50]])],
			]),
		);
		const projected = simulate(prepared.request).movementAttempts;
		expect(projected[0]).toMatchObject({
			date: "2026-02-01",
			origin: { postingId: "past-recurring" },
		});
		expect(projected).toHaveLength(13);
		expect(projected.map((event) => event.origin.postingId)).not.toContain(
			"first",
		);
	});

	it("applies checkpoints after same-date postings and replays later postings", () => {
		const document = createBaseDocument({
			accounts: [makeAccount({ id: "checking" })],
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 100 },
				{ Date: "2026-02-01", AccountId: "checking", Balance: 200 },
			],
			postings: [
				makePosting({
					id: "monthly-income",
					destinations: ["checking"],
					arithmetic: "10",
					startDate: "2026-01-01",
				}),
				makePosting({
					id: "one-time-income",
					destinations: ["checking"],
					arithmetic: "5",
					frequency: "once",
					startDate: "2026-01-15",
				}),
			],
		});

		const prepared = prepareSimulationRequest(
			document,
			makeSettings({ fallbackProjectionStartDate: "2026-03-01" }),
		);

		expect(prepared.historicalSnapshots).toEqual([
			{
				date: "2026-01-01",
				balances: { checking: 100 },
				checkpointCorrections: [
					{
						accountId: "checking",
						observedBalance: 100,
						modeledBalance: 10,
						adjustment: 90,
					},
				],
			},
			{ date: "2026-01-15", balances: { checking: 105 } },
			{
				date: "2026-02-01",
				balances: { checking: 200 },
				checkpointCorrections: [
					{
						accountId: "checking",
						observedBalance: 200,
						modeledBalance: 115,
						adjustment: 85,
					},
				],
			},
		]);
		expect(prepared.request.initialState.balances.checking).toBe(200);
		expect(simulate(prepared.request).movementAttempts[0]).toMatchObject({
			date: "2026-03-01",
			realizedAmount: 10,
		});
	});

	it("treats a projection-start checkpoint as end-of-day realized history", () => {
		const prepared = prepareSimulationRequest(
			createBaseDocument({
				accounts: [makeAccount({ id: "checking" })],
				checkpoints: [
					{ Date: "2026-02-01", AccountId: "checking", Balance: 100 },
				],
				postings: [
					makePosting({
						id: "start-income",
						destinations: ["checking"],
						arithmetic: "10",
						startDate: "2026-02-01",
					}),
				],
			}),
			makeSettings({ fallbackProjectionStartDate: "2026-02-01" }),
		);

		expect(prepared.request.includeStartDateEvents).toBe(false);
		expect(prepared.request.initialState.balances.checking).toBe(100);
		expect(
			prepared.request.initialState.latestRealizedPostingAmounts.get(
				"start-income",
			),
		).toBe(10);
		expect(simulate(prepared.request).movementAttempts[0]?.date).toBe(
			"2026-03-01",
		);
	});

	it("rejects checkpoints after the projection start", () => {
		expect(() =>
			prepareSimulationRequest(
				createBaseDocument({
					checkpoints: [
						{ Date: "2026-02-02", AccountId: "checking", Balance: 100 },
					],
				}),
				makeSettings({ fallbackProjectionStartDate: "2026-02-01" }),
			),
		).toThrow(/dated after the projection start/);
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
		expect(run.movementAttempts[0]).not.toHaveProperty("bindingConstraints");
		expect(run.finalState.balances.checking).toBe(150);
		expect(
			run.finalState.latestRealizedPostingAmounts.get("capped-dependent"),
		).toBe(100);
		expect(request.initialState).toEqual(originalState);
	});

	it("records exact dated snapshots and fully blocked attempts", () => {
		const prepared = prepareSimulationRequest(
			createBaseDocument({
				accounts: [makeAccount({ id: "checking", minBalance: 100 })],
				postings: [
					makePosting({
						id: "historical-balance",
						destinations: ["checking"],
						arithmetic: "100",
						frequency: "once",
						startDate: "2026-01-01",
					}),
					makePosting({
						id: "blocked",
						sourceAccountId: "checking",
						arithmetic: "50",
						startDate: "2026-01-10",
						endDate: "2026-01-10",
					}),
				],
			}),
			makeSettings({ fallbackProjectionStartDate: "2026-01-05" }),
		);

		const run = simulate(prepared.request);

		expect(run.snapshots).toHaveLength(1);
		expect(run.snapshots[0]).toMatchObject({
			date: "2026-01-10",
			balances: { checking: 100 },
		});
		expect(run.movementAttempts[0]).toMatchObject({
			realizedAmount: 0,
			accountDeltas: [],
		});
	});

	it("reuses a prepared request without cross-run state mutation", () => {
		const prepared = prepareSimulationRequest(
			createBaseDocument(),
			makeSettings(),
			undefined,
			{ annualRatesByPostingId: new Map([["salary", [0.1, 0.2]]]) },
		);
		const originalState = structuredClone(prepared.request.initialState);
		const originalDocument = structuredClone(prepared.effectiveDocument);

		const first = simulate(prepared.request);
		const second = simulate(prepared.request);

		expect(second).toEqual(first);
		expect(prepared.request.initialState).toEqual(originalState);
		expect(prepared.effectiveDocument).toEqual(originalDocument);
	});
});
