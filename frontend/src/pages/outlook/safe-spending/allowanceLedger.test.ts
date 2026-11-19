import { describe, expect, it } from "vitest";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { buildAllowanceLedger } from "./allowanceLedger.ts";

function summary(
	overrides: Partial<SafeSpendingSummary> = {},
): SafeSpendingSummary {
	return {
		revision: "synthetic",
		cashAsOf: "2026-11-15",
		status: "available",
		reasons: [],
		selectedAccountIds: ["checking"],
		baselines: [],
		checkingAvailable: 900,
		confirmedMovements: [],
		bills: [],
		payday: "2026-11-30",
		expectedPay: 400,
		prePaydayBills: 250,
		paydayBills: 0,
		statementReserve: 650,
		reserve: 200,
		prePaydayRoom: 450,
		postIncomeRoom: 200,
		safeToSpend: 200,
		statements: [],
		...overrides,
	};
}

describe("dated allowance", () => {
	it("uses the server's before-payday and after-income checks", () => {
		const { allowance } = buildAllowanceLedger(summary());
		expect(allowance).toMatchObject({
			payday: "2026-11-30",
			cashAsOf: "2026-11-15",
			status: "available",
			amount: 200,
			prePaydayRoom: 450,
			postIncomeRoom: 200,
			expectedPay: 400,
			reserve: 200,
		});
	});

	it("leaves zero room for a negative result", () => {
		const { allowance } = buildAllowanceLedger(summary({ safeToSpend: -75.5 }));
		expect(allowance.amount).toBe(0);
	});

	it("withholds the allowance without inventing arithmetic when evidence is uncertain", () => {
		const { allowance } = buildAllowanceLedger(
			summary({
				status: "uncertain",
				reasons: ["pending-obligation-coverage-unknown"],
				checkingAvailable: null,
				prePaydayRoom: null,
				postIncomeRoom: null,
				safeToSpend: null,
			}),
		);
		expect(allowance.status).toBe("uncertain");
		expect(allowance.amount).toBeNull();
	});

	it("treats missing evidence as unavailable", () => {
		const { allowance } = buildAllowanceLedger(
			summary({ status: "missing", payday: null, safeToSpend: null }),
		);
		expect(allowance.status).toBe("missing");
		expect(allowance.amount).toBeNull();
		expect(allowance.payday).toBeNull();
	});
});

describe("protected obligation ledger", () => {
	it("groups bills by the selected payday and keeps the server totals", () => {
		const { sections } = buildAllowanceLedger(
			summary({
				bills: [
					{
						id: "phone",
						transactionId: null,
						scheduleId: "phone-rule",
						accountId: "checking",
						name: "Phone",
						date: "2026-11-20",
						amount: 250,
						status: "unpaid",
					},
					{
						id: "rent",
						transactionId: null,
						scheduleId: "rent-rule",
						accountId: "checking",
						name: "Rent",
						date: "2026-11-30",
						amount: 0,
						status: "paid",
					},
					{
						id: "power",
						transactionId: "power-payment",
						scheduleId: null,
						accountId: "checking",
						name: "Power",
						date: "2026-11-30",
						amount: null,
						status: "unknown",
					},
				],
				statements: [
					{
						accountId: "prime_card",
						name: "Prime card",
						closingDate: "2026-11-28",
						kind: "closed",
						amount: 500,
					},
				],
			}),
		);
		expect(sections.map((section) => [section.title, section.total])).toEqual([
			["Bills before payday", 250],
			["Bills on payday", 0],
			["Card payoff on payday", 650],
		]);
		expect(sections[0]!.rows.map((row) => row.name)).toEqual(["Phone"]);
		expect(sections[1]!.rows.map((row) => row)).toEqual([
			{
				id: "power",
				name: "Power",
				date: "2026-11-30",
				amount: null,
				detail: "Payment unknown",
			},
		]);
		expect(sections[2]!.rows).toEqual([
			{
				id: "prime_card-2026-11-28-closed",
				name: "Prime card",
				date: "2026-11-28",
				amount: 500,
				detail: "Closed statement",
			},
		]);
	});

	it("marks projected statement amounts as estimates", () => {
		const { sections } = buildAllowanceLedger(
			summary({
				statements: [
					{
						accountId: "card",
						name: "Card",
						closingDate: "2026-11-27",
						kind: "estimated",
						amount: 150,
					},
				],
			}),
		);
		expect(sections[2]!.rows[0]!.detail).toBe("Estimated payoff");
	});

	it("keeps every known obligation visible when the allowance is unavailable", () => {
		const { sections } = buildAllowanceLedger(
			summary({
				status: "missing",
				safeToSpend: null,
				payday: null,
				prePaydayBills: null,
				bills: [
					{
						id: "bill",
						transactionId: null,
						scheduleId: null,
						accountId: "checking",
						name: "Bill",
						date: "2026-11-25",
						amount: 40,
						status: "pending",
					},
				],
			}),
		);
		expect(sections[0]!.rows[0]).toMatchObject({
			name: "Bill",
			detail: "Pending",
		});
	});
});

describe("evidence state", () => {
	it("surfaces the server state and independent baseline balances", () => {
		const { evidence } = buildAllowanceLedger(
			summary({
				status: "uncertain",
				reasons: ["posted-hold-coverage-unknown"],
				checkingAvailable: null,
				baselines: [
					{
						accountId: "checking",
						accountName: "Synthetic checking",
						observedAt: 1794733200,
						postedBalance: 1000,
						availableBalance: null,
						basis: "posted",
						status: "uncertain",
						reasons: ["posted-hold-coverage-unknown"],
					},
				],
			}),
		);
		expect(evidence.status).toBe("uncertain");
		expect(evidence.message).toBe("Allowance uncertain");
		expect(evidence.baselines).toEqual([
			{
				accountId: "checking",
				accountName: "Synthetic checking",
				basis: "posted",
				status: "uncertain",
				amount: 1000,
			},
		]);
	});

	it("does not expose internal reason codes", () => {
		const { evidence } = buildAllowanceLedger(
			summary({ status: "missing", reasons: ["__proto__"] }),
		);
		expect(evidence.message).toBe("Allowance unavailable");
		expect(JSON.stringify(evidence)).not.toContain("__proto__");
	});
});

describe("protected spending summary", () => {
	it("combines the server's obligation totals for the one-line preview", () => {
		const ledger = buildAllowanceLedger(
			summary({
				bills: [
					{
						id: "bill",
						transactionId: null,
						scheduleId: null,
						accountId: "checking",
						name: "Bill",
						date: "2026-11-20",
						amount: 250,
						status: "unpaid",
					},
				],
				statements: [
					{
						accountId: "card",
						name: "Card",
						closingDate: "2026-11-28",
						kind: "closed",
						amount: 650,
					},
				],
			}),
		);
		expect(ledger.protectedTotal).toBe(900);
		expect(ledger.obligationCount).toBe(2);
	});

	it("withholds the total when one obligation total is unknown", () => {
		const ledger = buildAllowanceLedger(summary({ statementReserve: null }));
		expect(ledger.protectedTotal).toBeNull();
	});
});
