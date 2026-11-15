import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { SafeSpendingCashEvidence } from "./SafeSpendingCashEvidence.tsx";

function summary(
	overrides: Partial<SafeSpendingSummary> = {},
): SafeSpendingSummary {
	return {
		revision: "synthetic",
		selectedAccountIds: ["checking"],
		start: "2026-11-15",
		end: "2026-11-30",
		status: "available",
		reasons: [],
		checkingAvailable: 1244.43,
		outstandingBillsTotal: 1461.01,
		cashAfterBills: -216.58,
		baselines: [
			{
				accountId: "checking",
				accountName: "Synthetic checking",
				observedAt: Date.parse("2026-11-14T18:00:00Z") / 1000,
				postedBalance: 1608.05,
				availableBalance: 1244.43,
				basis: "available",
				status: "available",
				reasons: [],
			},
		],
		confirmedMovements: [],
		outstandingObligations: [
			{
				id: "due-today",
				transactionId: null,
				scheduleId: "test",
				accountId: "checking",
				name: "Synthetic due today",
				date: "2026-11-15",
				amount: 711.12,
				status: "outstanding",
			},
		],
		...overrides,
	};
}

const render = (data: SafeSpendingSummary, historical = false) =>
	renderToStaticMarkup(
		<SafeSpendingCashEvidence
			summary={data}
			historical={historical}
			pending={false}
			error={false}
			onRetry={() => {}}
		/>,
	);

describe("safe spending cash evidence", () => {
	it("renders the server amount and due-today rows with exact independent observation provenance", () => {
		const html = render(summary());
		expect(html).toContain("-$216.58");
		expect(html).not.toContain("Short by");
		expect(html).toMatch(
			/class="[^"]*text-danger-text[^"]*" data-testid="left-value"/,
		);
		expect(html).toContain("Synthetic due today");
		expect(html).toContain("Synthetic checking");
		expect(html).toContain("2026-11-14T18:00:00.000Z");
		expect(html).toContain("Bills due Nov 15 – Nov 30");
		expect(html).toContain("Nov 15–30 bills · income excluded");
		expect(html).toContain("Future income and earlier bills are excluded.");
		expect(html).not.toContain("Cash accounts");
		expect(html).not.toContain('role="img"');
	});
	it("renders uncertain cash as unavailable instead of performing local arithmetic", () => {
		const html = render(
			summary({
				cashAfterBills: null,
				status: "uncertain",
				reasons: ["pending-obligation-coverage-unknown"],
			}),
		);
		expect(html).toContain('data-testid="left-value">—');
		expect(html).toContain(
			"A pending payment may already be included in available cash, so the exact remainder is unavailable.",
		);
		expect(html).not.toContain("-$216.58");
		expect(html).not.toContain("Short by");
	});
	it("preserves independent baseline evidence when the current cash aggregate is uncertain", () => {
		const html = render(
			summary({
				checkingAvailable: null,
				cashAfterBills: null,
				status: "uncertain",
				reasons: ["pending-after-baseline-coverage-unknown"],
			}),
		);
		expect(html).toContain('data-testid="left-value">—');
		expect(html).toMatch(
			/Synthetic checking · observed available<\/dt><dd[^>]*>\$1,244.43/,
		);
		expect(html).toContain("Posted $1,608.05 · Available $1,244.43");
		expect(html).toContain(
			"A pending payment may already be included in available cash, so the exact remainder is unavailable.",
		);
		expect(html).not.toContain("-$216.58");
	});
	it.each([0, 100])(
		"does not label non-negative cash %s as a shortfall",
		(cashAfterBills) => {
			const html = render(summary({ cashAfterBills }));
			expect(html).not.toContain("Short by");
			expect(html).not.toContain("text-danger-text");
		},
	);
	it("explains a posted payment's unresolved hold coverage", () => {
		const html = render(
			summary({
				cashAfterBills: null,
				status: "uncertain",
				reasons: ["posted-hold-coverage-unknown"],
			}),
		);
		expect(html).toContain(
			"A posted payment may still be covered by a hold in the observed available balance",
		);
		expect(html).not.toContain("posted-hold-coverage-unknown");
	});
	it.each(["new-internal-reason", "__proto__"])(
		"uses a generic explanation for unknown reason %s",
		(reason) => {
			const html = render(
				summary({
					cashAfterBills: null,
					status: "uncertain",
					reasons: [reason],
				}),
			);
			expect(html).toContain("Some cash evidence could not be verified.");
			expect(html).not.toContain(reason);
		},
	);
	it("marks an in-range scheduled payment with unresolved payment evidence", () => {
		const html = render(
			summary({
				cashAfterBills: null,
				status: "uncertain",
				reasons: ["scheduled-payment-status-unknown"],
				outstandingObligations: [
					{
						id: "unknown-payment",
						transactionId: null,
						scheduleId: "test",
						accountId: "checking",
						name: "Unknown payment",
						date: "2026-11-15",
						amount: 100,
						status: "payment-status-unknown",
					},
				],
			}),
		);
		expect(html).toContain("Payment status unknown");
		expect(html).toContain('data-testid="left-value">—');
	});
	it("renders genuine close cash rather than the conditional result of a one-day range", () => {
		const html = render(
			summary({
				start: "2026-10-19",
				end: "2026-10-19",
				cashAfterBills: 10000,
				outstandingBillsTotal: 100,
				checkingAvailable: 450.25,
			}),
			true,
		);
		expect(html).toContain("$450.25");
		expect(html).not.toContain("Cash balance at close unavailable");
		expect(html).not.toContain("Synthetic due today");
		expect(html).not.toContain("$10,000.00");
		expect(html).toContain("Available cash at close");
	});
	it("does not replace missing close evidence with current cash", () => {
		const html = render(
			summary({
				start: "2026-10-19",
				end: "2026-10-19",
				status: "missing",
				cashAfterBills: null,
				outstandingBillsTotal: null,
				checkingAvailable: null,
				baselines: [],
			}),
			true,
		);
		expect(html).toContain("No balance recorded at close");
		expect(html).not.toContain("1,244.43");
		expect(html).toContain(
			"An observed posted balance is not an available balance.",
		);
	});
	it("keeps a posted close observation distinct from missing available cash", () => {
		const html = render(
			summary({
				start: "2026-10-19",
				end: "2026-10-19",
				checkingAvailable: null,
				cashAfterBills: null,
				status: "missing",
				baselines: [
					{
						accountId: "checking",
						accountName: "Synthetic checking",
						observedAt: Date.parse("2026-10-18T18:00:00Z") / 1000,
						postedBalance: 500,
						availableBalance: null,
						basis: "posted",
						status: "missing",
						reasons: ["available-balance-missing"],
					},
				],
			}),
			true,
		);
		expect(html).not.toContain('data-testid="close-cash-value"');
		expect(html).toContain("Posted $500.00 · Available —");
		expect(html).toContain("Available cash at close is not evidenced");
	});
	it("keeps known cash visible while collapsing verbose and duplicate uncertainty explanations", () => {
		const html = render(
			summary({
				cashAfterBills: null,
				status: "uncertain",
				reasons: [
					"pending-after-baseline-coverage-unknown",
					"pending-obligation-coverage-unknown",
				],
			}),
		);
		const collapsed = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
		expect(collapsed).toContain("$1,244.43");
		expect(collapsed).toContain("Remainder uncertain");
		expect(collapsed).not.toContain("Posted");
		expect(collapsed).not.toContain("pending payment");
		expect(collapsed).not.toContain("Synthetic due today");
		expect(html).toContain(
			'<details><summary class="text-sm">Details</summary>',
		);
		expect(html).toContain(
			'<details><summary class="text-sm">Bills $1,461.01</summary>',
		);
		expect(html).not.toContain("<details open");
		expect(html.match(/A pending payment may already/g)).toHaveLength(1);
	});
});
