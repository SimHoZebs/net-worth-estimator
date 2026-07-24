import { describe, expect, it } from "vitest";
import { makeAccount, makePosting } from "../__fixtures__";
import {
	cloneSimulationState,
	createTransitionRuntime,
} from "../simulation/transitions";
import type { SimulationState } from "../types/simulation";

function state(overrides: Partial<SimulationState> = {}): SimulationState {
	return {
		balances: { checking: 500, brokerage: 0 },
		latestRealizedPostingAmounts: new Map(),
		realizedPostingAmountsByYear: new Map(),
		...overrides,
	};
}

function runtime(
	initialState: SimulationState,
	postings = [makePosting({ id: "posting" })],
	sampledRates?: ReadonlyMap<string, readonly number[]>,
) {
	return createTransitionRuntime({
		model: {
			accounts: [
				makeAccount({ id: "checking", minBalance: 0 }),
				makeAccount({ id: "brokerage", maxBalance: 1_000 }),
			],
			postings,
		},
		initialState,
		projectionStartDate: "2026-01-01",
		sampledAssumptions:
			sampledRates === undefined
				? undefined
				: { annualRatesByPostingId: sampledRates },
	});
}

describe("simulation transitions", () => {
	it("executes dependent capped postings and updates runtime state", () => {
		const posting = makePosting({
			id: "dependent",
			sourceAccountId: "checking",
			destinations: ["brokerage"],
			arithmetic: "base * 0.5",
			annualCap: 600,
		});
		const transitions = runtime(
			state({
				latestRealizedPostingAmounts: new Map([["base", 1_000]]),
				realizedPostingAmountsByYear: new Map([
					["dependent", new Map([["2026", 500]])],
				]),
			}),
			[posting],
		);

		const transition = transitions.executePosting(
			{ posting, index: 0 },
			"2026-02-01",
		);

		expect(transition).toMatchObject({
			result: { requestedAmount: 500, realizedAmount: 100 },
			accountDeltas: [
				{ accountId: "checking", delta: -100 },
				{ accountId: "brokerage", delta: 100 },
			],
		});
		expect(
			transitions.state.latestRealizedPostingAmounts.get("dependent"),
		).toBe(100);
		expect(
			transitions.state.realizedPostingAmountsByYear
				.get("dependent")
				?.get("2026"),
		).toBe(600);
	});

	it("records zero realization as the latest dependency value", () => {
		const posting = makePosting({
			id: "blocked",
			sourceAccountId: "checking",
			arithmetic: "50",
		});
		const transitions = createTransitionRuntime({
			model: {
				accounts: [makeAccount({ id: "checking", minBalance: 500 })],
				postings: [posting],
			},
			initialState: state({ balances: { checking: 500 } }),
			projectionStartDate: "2026-01-01",
		});

		const transition = transitions.executePosting(
			{ posting, index: 0 },
			"2026-02-01",
		);

		expect(transition).toMatchObject({
			result: {
				realizedAmount: 0,
				bindingConstraints: [{ type: "source-floor", accountId: "checking" }],
			},
			accountDeltas: [],
		});
		expect(transitions.state.latestRealizedPostingAmounts.get("blocked")).toBe(
			0,
		);
	});

	it("observes posting values without applying their account movement", () => {
		const dependent = makePosting({
			id: "dependent",
			destinations: ["brokerage"],
			arithmetic: "income * 0.5",
		});
		const transitions = runtime(state(), [dependent]);

		transitions.observePosting("income", 200);
		const transition = transitions.executePosting(
			{ posting: dependent, index: 0 },
			"2026-02-01",
		);

		expect(transitions.state.balances).toEqual({
			checking: 500,
			brokerage: 100,
		});
		expect(transition.result.realizedAmount).toBe(100);
	});

	it("applies generated movements without changing posting ledgers", () => {
		const initial = state({
			balances: { checking: 300, brokerage: 0 },
			latestRealizedPostingAmounts: new Map([["income", 200]]),
			realizedPostingAmountsByYear: new Map([
				["income", new Map([["2026", 200]])],
			]),
		});
		const transitions = runtime(initial);

		const transition = transitions.executeGeneratedMovement({
			sourceAccountId: "checking",
			destinations: null,
			requestedAmount: 250,
			limitRemaining: 200,
		});

		expect(transition).toMatchObject({
			result: {
				realizedAmount: 200,
				bindingConstraints: [{ type: "action-limit" }],
			},
			accountDeltas: [{ accountId: "checking", delta: -200 }],
		});
		expect(transitions.state.latestRealizedPostingAmounts).toEqual(
			initial.latestRealizedPostingAmounts,
		);
		expect(transitions.state.realizedPostingAmountsByYear).toEqual(
			initial.realizedPostingAmountsByYear,
		);
	});

	it("uses sampled rates only for volatile postings", () => {
		const volatile = makePosting({
			id: "volatile",
			destinations: ["brokerage"],
			arithmetic: "100 * rate",
			annualRate: 0.12,
			volatility: 0.2,
		});
		const fixed = { ...volatile, id: "fixed", volatility: 0 };
		const sampledRates = new Map([
			["volatile", [0.24]],
			["fixed", [0.24]],
		]);
		const transitions = runtime(state(), [volatile, fixed], sampledRates);

		const sampled = transitions.executePosting(
			{ posting: volatile, index: 0 },
			"2026-02-01",
		);
		const deterministic = transitions.executePosting(
			{ posting: fixed, index: 1 },
			"2026-02-01",
		);

		expect(sampled.result.requestedAmount).toBe(2);
		expect(deterministic.result.requestedAmount).toBe(1);
	});

	it("deeply clones annual-cap state", () => {
		const original = state({
			realizedPostingAmountsByYear: new Map([
				["posting", new Map([["2026", 100]])],
			]),
		});
		const clone = cloneSimulationState(original);

		clone.realizedPostingAmountsByYear.get("posting")?.set("2026", 200);

		expect(
			original.realizedPostingAmountsByYear.get("posting")?.get("2026"),
		).toBe(100);
	});
});
