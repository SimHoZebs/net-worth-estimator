import { describe, expect, it } from "vitest";
import { testPlan as examplePlan } from "../test/plan.ts";
import { activityProjection } from "../test/projection.ts";
import {
	accountTransactions,
	defaultActivityFilters,
	filterTransactions,
} from "./accountActivity.ts";
import { exactMoney } from "./format.ts";

const projection = activityProjection();

describe("account-scoped transactions", () => {
	it("preserves cents in transaction amounts", () => {
		expect(exactMoney(12.45)).toBe("$12.45");
		expect(exactMoney(0.01)).toBe("$0.01");
		expect(exactMoney(1000)).toBe("$1,000.00");
	});
	it("includes recorded history and the dated projected occurrences belonging to an account", () => {
		const rows = accountTransactions({
			accountId: "checking",
			plan: examplePlan,
			projection,
		});
		expect(rows.filter((row) => row.source === "recorded")).toHaveLength(3);
		expect(rows.some((row) => row.movementId === "renovation")).toBe(true);
		expect(
			rows.filter((row) => row.movementId === "invest").length,
		).toBeGreaterThan(100);
		expect(
			rows.every(
				(row) =>
					row.from === "Everyday checking" || row.to === "Everyday checking",
			),
		).toBe(true);
		expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
	});

	it("does not duplicate recorded evidence from server events on or before the plan start", () => {
		const source = projection.movements.find(
			(movement) =>
				movement.fromId === "checking" || movement.toId === "checking",
		);
		if (!source) throw new Error("Expected a checking movement fixture.");
		const historical = {
			...source,
			movementId: "historical-server-event",
			date: examplePlan.startDate,
		};
		const rows = accountTransactions({
			accountId: "checking",
			plan: examplePlan,
			projection: {
				...projection,
				movements: [historical, ...projection.movements],
			},
		});
		expect(
			rows.some((row) => row.movementId === "historical-server-event"),
		).toBe(false);
	});

	it("shows the same transfer as money out of the source and money into the destination", () => {
		const checking = accountTransactions({
			accountId: "checking",
			plan: examplePlan,
			projection,
		});
		const brokerage = accountTransactions({
			accountId: "brokerage",
			plan: examplePlan,
			projection,
		});
		const outgoing = checking.find((row) => row.movementId === "invest");
		const incoming = brokerage.find((row) => row.movementId === "invest");
		expect(outgoing).toMatchObject({
			category: "transfer",
			direction: "out",
			counterparty: "Investment portfolio",
		});
		expect(incoming).toMatchObject({
			category: "transfer",
			direction: "in",
			counterparty: "Everyday checking",
		});
		expect(incoming?.amount).toBe(outgoing?.amount);
	});

	it("includes secondary destinations from server account deltas", () => {
		const source = projection.movements.find(
			(movement) => movement.movementId === "invest",
		);
		if (!source) throw new Error("Expected an investment movement fixture.");
		const multi = {
			...source,
			movementId: "multi-destination",
			requested: 100,
			realized: 100,
			accountDeltas: [
				{ accountId: "checking", delta: -100 },
				{ accountId: "brokerage", delta: 60 },
				{ accountId: "savings", delta: 40 },
			],
		};
		const rows = accountTransactions({
			accountId: "savings",
			plan: examplePlan,
			projection: { ...projection, movements: [multi] },
		});
		expect(rows).toContainEqual(
			expect.objectContaining({
				movementId: "multi-destination",
				direction: "in",
				category: "transfer",
				counterparty: "Everyday checking",
				amount: 40,
			}),
		);
	});

	it("preserves requested and funded amounts and the reason for a shortfall", () => {
		const rows = accountTransactions({
			accountId: "checking",
			plan: examplePlan,
			projection,
		});
		const failure = rows.find((row) => row.movementId === "renovation");
		expect(failure?.requested).toBe(48000);
		expect(failure?.amount).toBeLessThan(48000);
		expect(failure?.shortfall).toBeCloseTo(48000 - (failure?.amount ?? 0));
		expect(failure?.constraint).toBe("Protected account balance");
	});

	it("keeps excluded recorded facts visible and excludes disabled planned rules", () => {
		const plan = structuredClone(examplePlan);
		for (const movement of plan.movements) {
			if (movement.id === "pay-record-0" || movement.id === "invest")
				movement.enabled = false;
		}
		const rows = accountTransactions({
			accountId: "checking",
			plan,
			projection: activityProjection(plan),
		});
		expect(
			rows.find((row) => row.movementId === "pay-record-0")?.excluded,
		).toBe(true);
		expect(rows.some((row) => row.movementId === "invest")).toBe(false);
	});

	it("has no manufactured transactions for growth-only or unknown accounts", () => {
		expect(
			accountTransactions({ accountId: "home", plan: examplePlan, projection }),
		).toEqual([]);
		expect(
			accountTransactions({
				accountId: "missing",
				plan: examplePlan,
				projection,
			}),
		).toEqual([]);
	});

	it("omits zero-value scheduled payments after a debt has been paid off", () => {
		const rows = accountTransactions({
			accountId: "mortgage",
			plan: examplePlan,
			projection,
		});
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.requested > 0)).toBe(true);
		expect(rows.every((row) => row.direction === "in")).toBe(true);
	});
});

describe("transaction filtering", () => {
	const transactions = accountTransactions({
		accountId: "checking",
		plan: examplePlan,
		projection,
	});
	const apply = (filters: Partial<typeof defaultActivityFilters>) =>
		filterTransactions({
			transactions,
			startDate: examplePlan.startDate,
			filters: { ...defaultActivityFilters, ...filters },
		});

	it("searches both movement names and the other account", () => {
		expect(apply({ query: "RENOVATION" })).toHaveLength(1);
		expect(
			apply({ query: "Investment portfolio" }).every(
				(row) => row.movementId === "invest",
			),
		).toBe(true);
		expect(apply({ query: "no matching record" })).toEqual([]);
	});

	it("separates recorded facts, projected activity and direction", () => {
		expect(apply({ source: "recorded" })).toHaveLength(3);
		expect(
			apply({ direction: "transfer" }).every(
				(row) => row.category === "transfer",
			),
		).toBe(true);
		expect(
			apply({ direction: "out" }).every((row) => row.direction === "out"),
		).toBe(true);
		expect(apply({ source: "recorded", direction: "out" })).toHaveLength(0);
	});

	it("filters the next 30 days from the plan date rather than the wall clock", () => {
		const rows = apply({ period: "30-days" });
		expect(rows).toHaveLength(5);
		expect(
			rows.every((row) => row.date > "2026-09-24" && row.date <= "2026-10-24"),
		).toBe(true);
	});

	it("sorts without mutating the complete transaction set", () => {
		const before = JSON.stringify(transactions);
		const rows = apply({ source: "recorded", order: "newest" });
		expect(rows.map((row) => row.date)).toEqual([
			"2026-08-28",
			"2026-07-28",
			"2026-06-28",
		]);
		expect(JSON.stringify(transactions)).toBe(before);
	});
});
