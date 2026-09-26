import { describe, expect, it } from "vitest";
import {
	captureComparison,
	changeDetails,
	comparisonContext,
	comparisonMetrics,
} from "./comparison.ts";
import { examplePlan } from "./example.ts";
import { money } from "./format.ts";
import { netWorth, type Plan } from "./model.ts";
import type { Projection } from "./projection.ts";

const projection: Projection = {
	currentNetWorth: 120,
	points: [{ date: "2030-01-01", total: 450, balances: {} }],
	goals: [],
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
	current: comparisonMetrics(projection, examplePlan),
	capturedAt: "2026-09-26T12:00:00.000Z",
});

describe("comparison measures and snapshots", () => {
	it("uses projection starting wealth, last point, and first declared net-worth goal", () => {
		const goal = { ...examplePlan.goals[0]!, kind: "net-worth" as const };
		expect(
			comparisonMetrics(
				{
					...projection,
					goals: [
						{
							goal: { ...goal, kind: "reserve" },
							current: 0,
							final: 0,
							firstDate: "2027-01-01",
						},
						{ goal, current: 0, final: 0, firstDate: "2030-01-01" },
						{
							goal: { ...goal, id: "earlier" },
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
				},
				examplePlan,
			),
		).toEqual({
			current: 120,
			final: 450,
			goalDate: "2030-01-01",
			shortfallDate: "2029-01-01",
		});
	});
	it("preserves empty projection defaults and plan fallback without discarding zero wealth", () => {
		expect(
			comparisonMetrics(
				{ ...projection, points: [], currentNetWorth: undefined },
				examplePlan,
			),
		).toEqual({
			current: netWorth(examplePlan),
			final: 0,
			goalDate: null,
			shortfallDate: null,
		});
		expect(
			comparisonMetrics({ ...projection, currentNetWorth: 0 }, examplePlan)
				.current,
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
					rate: account.annualReturn,
					balance: account.balance,
					observedOn: account.observedOn,
					source: account.source,
				})),
			}),
			current: 120,
			final: 450,
			goalDate: null,
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
			"rate",
			(plan) => {
				plan.accounts[0]!.annualReturn++;
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
	it("checks horizon while allowing goal and movement changes in the same context", () => {
		expect(comparisonContext({ ...input, snapshot, years: 5 }).comparable).toBe(
			false,
		);
		const plan = structuredClone(examplePlan);
		plan.goals[0]!.target++;
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
		plan.goals.push({ ...plan.goals[0]!, id: "new", name: "New goal" });
		plan.assumptions.inflation++;
		plan.name += " changed";
		expect(
			comparisonContext({ ...input, plan }).changes.map(({ kind }) => kind),
		).toEqual(["Modified", "Removed", "Added", "Modified", "Modified"]);
	});
});

describe("change detail rows", () => {
	it("formats values and retains field order while hiding internal and unchanged fields", () => {
		expect(
			changeDetails({
				before: JSON.stringify({
					id: "old",
					readOnly: false,
					name: "Same",
					amount: 10,
					enabled: true,
					ceiling: null,
					custom: "old",
					inflation: 2,
				}),
				after: JSON.stringify({
					id: "new",
					readOnly: true,
					name: "Same",
					amount: 20,
					enabled: false,
					ceiling: 50,
					inflation: 3,
					source: "Bank",
				}),
			}),
		).toEqual({
			kind: "fields",
			rows: [
				{ key: "amount", label: "Amount", before: money(10), after: money(20) },
				{ key: "enabled", label: "Included", before: "Yes", after: "No" },
				{
					key: "ceiling",
					label: "Maximum balance",
					before: "None",
					after: money(50),
				},
				{ key: "custom", label: "custom", before: "old", after: "None" },
				{ key: "inflation", label: "Inflation (%)", before: "2", after: "3" },
				{ key: "source", label: "Source", before: "None", after: "Bank" },
			],
		});
	});
	it("represents added and removed object fields as None", () => {
		expect(changeDetails({ before: "", after: '{"target":100}' })).toEqual({
			kind: "fields",
			rows: [
				{ key: "target", label: "Target", before: "None", after: money(100) },
			],
		});
		expect(changeDetails({ before: '{"enabled":false}', after: "" })).toEqual({
			kind: "fields",
			rows: [
				{ key: "enabled", label: "Included", before: "No", after: "None" },
			],
		});
	});
	it("retains plain text and empty-side labels", () => {
		expect(changeDetails({ before: "Old plan", after: "New plan" })).toEqual({
			kind: "text",
			before: "Old plan",
			after: "New plan",
		});
		expect(changeDetails({ before: "", after: "New plan" })).toEqual({
			kind: "text",
			before: "New",
			after: "New plan",
		});
		expect(changeDetails({ before: "Old plan", after: "" })).toEqual({
			kind: "text",
			before: "Old plan",
			after: "Removed",
		});
	});
});
