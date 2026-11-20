import { describe, expect, it } from "vitest";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { buildAllowanceLedger } from "./allowanceLedger.ts";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";

function summary(
	overrides: Partial<SafeSpendingSummary> = {},
): SafeSpendingSummary {
	return summaryFixture({
		cashAsOf: "2026-11-15",
		checkingAvailable: 900,
		expectedPay: 400,
		prePaydayBills: 250,
		paydayBills: 0,
		statementReserve: 650,
		cardPayoffCapacity: null,
		prePaydayRoom: 450,
		postIncomeRoom: 200,
		postPaydayBalance: 400,
		paymentRoom: 350,
		safeToSpend: 200,
		...overrides,
	});
}

describe("dated allowance", () => {
	it("uses the server's before-payday and after-income checks", () => {
		const { allowance } = buildAllowanceLedger(summary());
		expect(allowance).toMatchObject({
			payday: "2026-11-30",
			cashAsOf: "2026-11-15",
			status: "available",
			prePaydayRoom: 450,
			postIncomeRoom: 200,
			paymentRoom: 350,
			expectedPay: 400,
		});
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
	});

	it("treats missing evidence as unavailable", () => {
		const { allowance } = buildAllowanceLedger(
			summary({ status: "missing", payday: null, safeToSpend: null }),
		);
		expect(allowance.status).toBe("missing");
		expect(allowance.payday).toBeNull();
	});
});

describe("protected obligation ledger", () => {
	it("groups expected bills by payday and omits a paid occurrence", () => {
		const { sections } = buildAllowanceLedger(
			summary({
				bills: [
					{
						id: "phone",
						actualDate: null,
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
						actualDate: "2026-11-29",
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
						actualDate: null,
						transactionId: null,
						scheduleId: null,
						accountId: "checking",
						name: "Power",
						date: "2026-11-30",
						amount: null,
						status: "unpaid",
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
			["Bills before card payoff", 250],
			["Bills on card payoff date", 0],
			["Credit card payoffs", 650],
		]);
		expect(sections[0]!.rows.map((row) => row.name)).toEqual(["Phone"]);
		expect(
			sections.flatMap((section) => section.rows.map((row) => row.name)),
		).not.toContain("Rent");
		expect(sections[1]!.rows.map((row) => row)).toEqual([
			{
				id: "power",
				name: "Power",
				date: "2026-11-30",
				amount: null,
				detail: null,
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
						actualDate: null,
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
			detail: null,
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

	it("keeps the signed room readings even when the summary is uncertain", () => {
		const ledger = buildAllowanceLedger(
			summary({
				status: "uncertain",
				prePaydayRoom: 325.5,
				postIncomeRoom: 120,
			}),
		);
		expect(ledger.allowance.status).toBe("uncertain");
		expect(ledger.allowance.prePaydayRoom).toBe(325.5);
		expect(ledger.allowance.postIncomeRoom).toBe(120);
	});
});

describe("protected spending summary", () => {
	it("combines the server's obligation totals for the one-line preview", () => {
		const ledger = buildAllowanceLedger(
			summary({
				bills: [
					{
						id: "bill",
						actualDate: null,
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
