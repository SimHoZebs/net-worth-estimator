import { describe, expect, it } from "vitest";
import { testPlan as examplePlan } from "../test/plan.ts";
import {
	captureComparison,
	changeDetails,
	comparisonContext,
	comparisonMetrics,
} from "./comparison.ts";
import type { Plan } from "./model.ts";
import type { Projection } from "./result.ts";

const projection: Projection = {
	currentNetWorth: 120,
	points: [{ date: "2030-01-01", total: 450, balances: {} }],
	evaluations: [],
	otherEvaluations: [],
	movements: [],
	firstFailure: null,
	inflows: 0,
	outflows: 0,
	transfers: 0,
};
const input = {
	saved: examplePlan,
	plan: examplePlan,
	projection,
	savedProjection: { ...projection, currentNetWorth: 100 },
	snapshot: null,
	years: 10,
};
const snapshot = captureComparison({
	plan: examplePlan,
	revision: 7,
	years: 10,
	changes: 2,
	current: comparisonMetrics(projection),
	capturedAt: "2026-09-26T12:00:00.000Z",
});

describe("comparison measures and snapshots", () => {
	it("uses projection starting wealth, last point, and first declared net-worth evaluation", () => {
		const evaluation = {
			...examplePlan.evaluations[0]!,
			kind: "net-worth" as const,
		};
		expect(
			comparisonMetrics({
				...projection,
				evaluations: [
					{
						evaluation: { ...evaluation, kind: "reserve" as const },
						current: 0,
						final: 0,
						firstDate: "2027-01-01",
					},
					{ evaluation, current: 0, final: 0, firstDate: "2030-01-01" },
					{
						evaluation: { ...evaluation, id: "earlier" },
						current: 0,
						final: 0,
						firstDate: "2028-01-01",
					},
				],
				firstFailure: {
					date: "2029-01-01",
					movementId: "payment",
					name: "Payment",
					requested: 2,
					realized: 1,
					fromId: null,
					toId: null,
					available: null,
					constraint: null,
					accountDeltas: [],
				},
			}),
		).toEqual({
			current: 120,
			final: 450,
			evaluationDate: "2030-01-01",
			shortfallDate: "2029-01-01",
		});
	});
	it("keeps empty projection defaults and does not discard zero wealth", () => {
		expect(comparisonMetrics({ ...projection, points: [] })).toEqual({
			current: projection.currentNetWorth,
			final: 0,
			evaluationDate: null,
			shortfallDate: null,
		});
		expect(
			comparisonMetrics({ ...projection, currentNetWorth: 0 }).current,
		).toBe(0);
	});
	it("uses saved measures until a snapshot is present", () => {
		expect(comparisonContext(input)).toMatchObject({
			previous: { current: 100 },
			current: { current: 120 },
			comparable: true,
			changes: [],
		});
		expect(comparisonContext({ ...input, snapshot }).previous).toBe(snapshot);
		expect(comparisonContext({ ...input, snapshot }).comparable).toBe(true);
	});
	it("retains the persisted capture shape and assumption JSON field order", () => {
		expect(snapshot).toEqual({
			capturedAt: "2026-09-26T12:00:00.000Z",
			name: examplePlan.name,
			years: 10,
			startDate: examplePlan.startDate,
			revision: 7,
			changes: 2,
			assumptions: JSON.stringify({
				...examplePlan.assumptions,
				rates: examplePlan.accounts.map((account) => ({
					id: account.id,
					balance: account.balance,
					minBalance: account.minBalance,
					maxBalance: account.maxBalance,
					observedOn: account.observedOn,
					source: account.source,
				})),
			}),
			current: 120,
			final: 450,
			evaluationDate: null,
			shortfallDate: null,
		});
	});
	it.each<[string, (plan: Plan) => void]>([
		[
			"plan name",
			(plan) => {
				plan.name += " changed";
			},
		],
		[
			"start date",
			(plan) => {
				plan.startDate = "2026-10-01";
			},
		],
		[
			"inflation",
			(plan) => {
				plan.assumptions.inflation++;
			},
		],
		[
			"volatility",
			(plan) => {
				plan.assumptions.volatility++;
			},
		],
		[
			"balance",
			(plan) => {
				plan.accounts[0]!.balance++;
			},
		],
		[
			"protected balance",
			(plan) => {
				plan.accounts[0]!.minBalance++;
			},
		],
		[
			"balance date",
			(plan) => {
				plan.accounts[0]!.observedOn = "2020-01-01";
			},
		],
		[
			"source",
			(plan) => {
				plan.accounts[0]!.source += " changed";
			},
		],
		[
			"account order",
			(plan) => {
				plan.accounts.reverse();
			},
		],
	])("marks changed %s as a different context", (_label, edit) => {
		const plan = structuredClone(examplePlan);
		edit(plan);
		expect(comparisonContext({ ...input, plan, snapshot }).comparable).toBe(
			false,
		);
	});
	it("checks horizon while allowing evaluation and movement changes in the same context", () => {
		expect(comparisonContext({ ...input, snapshot, years: 5 }).comparable).toBe(
			false,
		);
		const plan = structuredClone(examplePlan);
		plan.evaluations[0]!.target++;
		plan.movements[0]!.amount++;
		plan.accounts[0]!.enabled = !plan.accounts[0]!.enabled;
		expect(comparisonContext({ ...input, plan, snapshot }).comparable).toBe(
			true,
		);
	});
	it("preserves JSON-order-only changes and their empty field details", () => {
		const plan = structuredClone(examplePlan);
		const { name, ...rest } = plan.accounts[0]!;
		plan.accounts[0] = { name, ...rest };
		const { changes } = comparisonContext({ ...input, plan });
		expect(changes).toHaveLength(1);
		expect(changes[0]!.kind).toBe("Modified");
		expect(changeDetails(changes[0]!)).toEqual({ kind: "fields", rows: [] });
	});
	it("keeps change counts and declaration order across edits, additions, and removals", () => {
		const plan = structuredClone(examplePlan);
		plan.accounts[0]!.balance++;
		plan.movements = plan.movements.slice(1);
		plan.evaluations.push({
			...plan.evaluations[0]!,
			id: "new",
			name: "New evaluation",
		});
		plan.assumptions.inflation++;
		plan.name += " changed";
		expect(
			comparisonContext({ ...input, plan }).changes.map(({ kind }) => kind),
		).toEqual(["Modified", "Removed", "Added", "Modified", "Modified"]);
	});
});

describe("change detail rows", () => {
	it("retains field order while hiding internal and unchanged fields", () => {
		const details = changeDetails({
			before: JSON.stringify({
				id: "old",
				readOnly: false,
				name: "Same",
				amount: 10,
				enabled: true,
				maxBalance: null,
				custom: "old",
				inflation: 2,
			}),
			after: JSON.stringify({
				id: "new",
				readOnly: true,
				name: "Same",
				amount: 20,
				enabled: false,
				maxBalance: 50,
				inflation: 3,
				source: "Bank",
			}),
		});
		expect(details.kind).toBe("fields");
		if (details.kind !== "fields") throw new Error("Expected fields");
		expect(details.rows.map((row) => row.key)).toEqual([
			"amount",
			"enabled",
			"maxBalance",
			"custom",
			"inflation",
			"source",
		]);
	});
	it("represents added and removed object fields", () => {
		const added = changeDetails({ before: "", after: '{"target":100}' });
		expect(added.kind).toBe("fields");
		if (added.kind !== "fields") throw new Error("Expected fields");
		expect(added.rows.map((row) => row.key)).toEqual(["target"]);

		const removed = changeDetails({ before: '{"enabled":false}', after: "" });
		expect(removed.kind).toBe("fields");
		if (removed.kind !== "fields") throw new Error("Expected fields");
		expect(removed.rows.map((row) => row.key)).toEqual(["enabled"]);
	});
	it("retains plain text changes", () => {
		expect(changeDetails({ before: "Old plan", after: "New plan" }).kind).toBe(
			"text",
		);
		expect(changeDetails({ before: "", after: "New plan" }).kind).toBe("text");
		expect(changeDetails({ before: "Old plan", after: "" }).kind).toBe("text");
	});
});
