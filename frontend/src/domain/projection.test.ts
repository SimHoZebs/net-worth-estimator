import { describe, expect, it } from "vitest";
import { payEvidence } from "./evidence.ts";
import { examplePlan } from "./example.ts";
import { changesBetween, netWorth, type Plan, validatePlan } from "./model.ts";
import {
	calculateRange,
	currentNetWorth,
	horizonDate,
	occurrences,
	project,
	quantile,
} from "./projection.ts";

const blank = (): Plan => ({
	...structuredClone(examplePlan),
	accounts: [
		{ ...examplePlan.accounts[0]!, balance: 10000, annualReturn: 0, floor: 0 },
	],
	movements: [],
	goals: [],
});

describe("validated plans", () => {
	it("accepts the authored example and computes assets less debts", () => {
		expect(validatePlan(examplePlan)).not.toBeInstanceOf(Error);
		expect(netWorth(examplePlan)).toBe(802450);
	});
	it("excludes disabled accounts from net worth and projections", () => {
		const plan = structuredClone(examplePlan);
		plan.accounts[2]!.enabled = false;
		expect(netWorth(plan)).toBe(587650);
		const result = project({ plan, years: 1 });
		expect(result.currentNetWorth).toBe(587650);
		expect(result.points.at(-1)?.total).toBeLessThan(802450);
	});
	it("rejects invalid account references, duplicate IDs, and positive debts", () => {
		const next = structuredClone(examplePlan);
		next.accounts[5]!.balance = 1;
		next.accounts[1]!.id = next.accounts[0]!.id;
		next.movements[0]!.toId = "absent";
		expect(validatePlan(next)).toBeInstanceOf(Error);
	});
	it("rejects backwards schedules and future recorded movements", () => {
		const next = structuredClone(examplePlan);
		next.movements[0]!.endDate = "2020-01-01";
		next.movements[0]!.provenance = "recorded";
		expect(validatePlan(next)).toBeInstanceOf(Error);
	});
	it("distinguishes added, modified, removed and excluded records", () => {
		const next = structuredClone(examplePlan);
		next.movements = next.movements.slice(1);
		next.accounts[0]!.balance++;
		next.goals.push({ ...next.goals[0]!, id: "new", name: "A new goal" });
		expect(
			changesBetween({ saved: examplePlan, current: next }).map((c) => c.kind),
		).toEqual(["Modified", "Removed", "Added"]);
	});
});

describe("dated projections", () => {
	it("keeps empty zero-rate plans unchanged and carries their starting position", () => {
		const plan = blank();
		const result = project({ plan, years: 20 });
		expect(result.points.at(-1)?.total).toBe(10000);
		expect(result.currentNetWorth).toBe(10000);
		expect(
			currentNetWorth({
				projection: result,
				plan: { ...plan, accounts: [{ ...plan.accounts[0]!, balance: 20000 }] },
			}),
		).toBe(10000);
		expect(result.firstFailure).toBeNull();
	});
	it("does not mutate the supplied plan", () => {
		const original = JSON.stringify(examplePlan);
		project({ plan: examplePlan, years: 20 });
		expect(JSON.stringify(examplePlan)).toBe(original);
	});
	it("respects protected balances and records the exact shortfall", () => {
		const plan = blank();
		plan.accounts[0]!.floor = 2500;
		plan.movements = [
			{
				...examplePlan.movements[1]!,
				frequency: "once",
				startDate: "2026-10-01",
				amount: 12000,
			},
		];
		const result = project({ plan, years: 10 });
		expect(result.firstFailure).toMatchObject({
			date: "2026-10-01",
			requested: 12000,
			realized: 7500,
			constraint: "Protected account balance",
		});
		expect(result.points.at(-1)?.total).toBe(2500);
	});
	it("does not create money in internal transfers", () => {
		const plan = blank();
		plan.accounts.push({ ...plan.accounts[0]!, id: "other", balance: 0 });
		plan.movements = [
			{
				...examplePlan.movements[3]!,
				toId: "other",
				amount: 1500,
				annualIncrease: 0,
			},
		];
		const result = project({ plan, years: 1 });
		expect(result.points.at(-1)?.total).toBe(10000);
		expect(result.inflows).toBe(0);
		expect(result.outflows).toBe(0);
	});
	it("stops incoming transfers at the destination ceiling", () => {
		const plan = blank();
		plan.accounts.push({
			...plan.accounts[0]!,
			id: "other",
			balance: 0,
			ceiling: 100,
		});
		plan.movements = [
			{
				...examplePlan.movements[3]!,
				toId: "other",
				frequency: "once",
				amount: 1500,
				annualIncrease: 0,
			},
		];
		const result = project({ plan, years: 1 });
		expect(result.firstFailure?.constraint).toBe("Destination account ceiling");
		expect(result.firstFailure?.realized).toBe(100);
		expect(result.points.at(-1)?.total).toBe(10000);
	});
	it("stops debt payments at zero without reporting a spurious shortfall", () => {
		const plan = blank();
		plan.accounts.push({
			...plan.accounts[0]!,
			id: "mortgage",
			kind: "debt",
			balance: -500,
			ceiling: 0,
		});
		plan.movements = [
			{ ...examplePlan.movements[2]!, amount: 700, annualIncrease: 0 },
		];
		const result = project({ plan, years: 1 });
		expect(result.points.at(-1)?.balances.mortgage).toBe(0);
		expect(result.points.at(-1)?.total).toBe(9500);
		expect(result.firstFailure).toBeNull();
	});
	it("does not replay recorded history already included in starting balances", () => {
		const plan = blank();
		plan.movements = [{ ...examplePlan.movements[6]! }];
		expect(project({ plan, years: 1 }).points.at(-1)?.total).toBe(10000);
	});
	it("clamps month-end recurrences and leap-year horizons", () => {
		const plan = blank();
		plan.movements = [
			{ ...examplePlan.movements[0]!, startDate: "2027-01-31" },
		];
		expect(
			occurrences({ plan, endDate: "2027-03-31" }).map((e) => e.date),
		).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
		expect(horizonDate({ start: "2028-02-29", years: 1 })).toBe("2029-02-28");
	});
	it("increases amounts on the actual anniversary rather than a rounded year length", () => {
		const plan = blank();
		plan.movements = [
			{
				...examplePlan.movements[0]!,
				amount: 1000,
				annualIncrease: 10,
				startDate: "2026-10-01",
			},
		];
		const events = occurrences({ plan, endDate: "2027-10-01" });
		expect(events.find((event) => event.date === "2027-09-01")?.amount).toBe(
			1000,
		);
		expect(events.find((event) => event.date === "2027-10-01")?.amount).toBe(
			1100,
		);
	});
	it("finds the earliest base-case failure and goal crossing", () => {
		const result = project({ plan: examplePlan, years: 20 });
		expect(result.firstFailure?.movementId).toBe("renovation");
		expect(result.firstFailure?.date).toBe("2028-06-15");
		expect(
			result.goals.find((g) => g.goal.id === "cash-buffer")?.firstDate,
		).toBe(examplePlan.startDate);
		expect(
			result.goals.find((g) => g.goal.id === "million")?.firstDate,
		).toBeTruthy();
	});
});

describe("scenario ranges and inference", () => {
	it("uses a percentile distribution rather than the band midpoint", () => {
		expect(quantile({ values: [1, 2, 3, 50, 100], fraction: 0.5 })).toBe(3);
	});
	it("is repeatable, keeps boundaries ordered, and collapses with zero variability", () => {
		const plan = blank();
		plan.assumptions.volatility = 0;
		const first = calculateRange({ plan, years: 1, count: 20 });
		const second = calculateRange({ plan, years: 1, count: 20 });
		expect(first).toEqual(second);
		for (const point of first.points)
			expect(point.lower === point.median && point.median === point.upper).toBe(
				true,
			);
	});
	it("varies investment assumptions and retains the fixed starting position", () => {
		const result = calculateRange({ plan: examplePlan, years: 2, count: 20 });
		expect(result.points[0]?.lower).toBe(802450);
		expect(result.points.at(-1)!.lower).toBeLessThan(
			result.points.at(-1)!.median,
		);
		expect(result.points.at(-1)!.median).toBeLessThan(
			result.points.at(-1)!.upper,
		);
	});
	it("keeps pay inference separate from planned income and excludes outliers", () => {
		const plan = structuredClone(examplePlan);
		plan.movements.push({
			...plan.movements[6]!,
			id: "outlier",
			amount: 100000,
			startDate: "2026-05-28",
		});
		const result = payEvidence(plan);
		expect(result.typical).toBe(11200);
		expect(result.monthly).toBe(true);
		expect(result.annualized).toBe(134400);
		expect(result.excluded.map((m) => m.id)).toContain("outlier");
		expect(result.comparable).toHaveLength(3);
		expect(result.strong).toBe(false);
	});
});
