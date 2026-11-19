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
		cashAsOf: "2026-11-15",
		bills: [
			{
				id: "due-today",
				transactionId: null,
				scheduleId: "test",
				accountId: "checking",
				name: "Phone",
				date: "2026-11-15",
				amount: 711.12,
				status: "unpaid",
			},
		],
		...overrides,
	};
}

const render = (data: SafeSpendingSummary) =>
	renderToStaticMarkup(
		<SafeSpendingCashEvidence
			summary={data}
			pending={false}
			error={false}
			onRetry={() => {}}
		/>,
	);

describe("safe spending cash evidence", () => {
	it("renders the server's unpaid total and hides only paid rows", () => {
		const [phone] = summary().bills!;
		const html = render(
			summary({
				bills: [
					phone!,
					{ ...phone!, id: "paid", name: "Rent", status: "paid", amount: 750 },
					{
						...phone!,
						id: "pending",
						name: "Power",
						status: "pending",
						amount: 18,
					},
					{
						...phone!,
						id: "unknown",
						name: "Water",
						status: "unknown",
						amount: null,
					},
				],
				outstandingBillsTotal: null,
				cashAfterBills: null,
				status: "uncertain",
			}),
		);
		expect(html).toMatch(/Upcoming bills<\/h3><strong[^>]*>—/);
		for (const label of [
			"Phone",
			"Power",
			"Water",
			"Nov 15</p>",
			"Nov 15 · Pending",
			"Nov 15 · Payment unknown",
		])
			expect(html).toContain(label);
		expect(html).not.toContain("Rent");
		expect(html).not.toContain("$750.00");
		expect(html).not.toContain("Unpaid");
	});
	it("shows a known zero when there are no cycle bills", () => {
		const html = render(summary({ bills: [], outstandingBillsTotal: 0 }));
		expect(html).toContain("No upcoming bills.");
		expect(html).toMatch(/Upcoming bills<\/h3><strong[^>]*>\$0.00/);
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
		expect(html).toContain("Remainder uncertain");
		expect(html).toContain("$1,244.43");
		expect(html).not.toContain("-$216.58");
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
			/Synthetic checking · observed available<\/dt><dd[^>]*>\$1,244\.43/,
		);
		expect(html).not.toContain("Posted");
		expect(html).toContain("Remainder uncertain");
		expect(html).not.toContain("-$216.58");
	});
	it.each([0, 100])(
		"does not label non-negative cash %s as a shortfall",
		(cashAfterBills) => {
			const html = render(summary({ cashAfterBills }));
			expect(html).not.toContain("text-danger-text");
		},
	);
	it("preserves uncertainty for a posted payment with unresolved hold coverage", () => {
		const html = render(
			summary({
				cashAfterBills: null,
				status: "uncertain",
				reasons: ["posted-hold-coverage-unknown"],
			}),
		);
		expect(html).toContain("Remainder uncertain");
		expect(html).toContain('data-testid="left-value">—');
		expect(html).not.toContain("posted-hold-coverage-unknown");
	});
	it.each(["new-internal-reason", "__proto__"])(
		"preserves uncertainty without exposing internal reason %s",
		(reason) => {
			const html = render(
				summary({
					cashAfterBills: null,
					status: "uncertain",
					reasons: [reason],
				}),
			);
			expect(html).toContain("Remainder uncertain");
			expect(html).not.toContain(reason);
		},
	);
	it("marks an in-range scheduled payment with unresolved payment evidence", () => {
		const html = render(
			summary({
				status: "uncertain",
				reasons: ["scheduled-payment-status-unknown"],
				checkingAvailable: null,
				cashAfterBills: null,
			}),
		);
		expect(html).toContain("Remainder uncertain");
		expect(html).toContain('data-testid="left-value">—');
	});
	it("renders missing close evidence with the same unavailable figure", () => {
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
		);
		expect(html).toContain('data-testid="left-value">—');
		expect(html).toContain("Remainder unavailable");
		expect(html).not.toContain("close-cash-value");
		expect(html).not.toContain("No balance recorded at close");
		expect(html).not.toContain("1,244.43");
	});
	it("lists posted baselines alongside observed available", () => {
		const html = render(
			summary({
				checkingAvailable: null,
				cashAfterBills: null,
				status: "uncertain",
				reasons: ["pending-after-baseline-coverage-unknown"],
				baselines: [
					{
						accountId: "checking",
						accountName: "Synthetic checking",
						observedAt: Date.parse("2026-11-14T18:00:00Z") / 1000,
						postedBalance: 1608.05,
						availableBalance: 1244.43,
						basis: "available",
						status: "uncertain",
						reasons: ["pending-after-baseline-coverage-unknown"],
					},
					{
						accountId: "savings",
						accountName: "Synthetic savings",
						observedAt: Date.parse("2026-11-14T18:00:00Z") / 1000,
						postedBalance: 500,
						availableBalance: null,
						basis: "posted",
						status: "uncertain",
						reasons: ["pending-after-baseline-coverage-unknown"],
					},
				],
			}),
		);
		expect(html).toMatch(
			/Synthetic checking · observed available<\/dt><dd[^>]*>\$1,244\.43/,
		);
		expect(html).toMatch(
			/Synthetic savings · posted balance<\/dt><dd[^>]*>\$500\.00/,
		);
		expect(html).toContain("Remainder uncertain");
	});
	it("keeps server cash facts visible without rendering backend diagnostic movements", () => {
		const html = render(
			summary({
				cashAfterBills: null,
				status: "uncertain",
				confirmedMovements: [
					{
						transactionId: "movement",
						accountId: "checking",
						name: "Diagnostic movement",
						effectiveAt: 1794744000,
						postedAt: 1794744000,
						amount: -12.34,
					},
				],
				reasons: [
					"pending-after-baseline-coverage-unknown",
					"pending-obligation-coverage-unknown",
				],
			}),
		);
		expect(html).toContain("$1,244.43");
		expect(html).toContain("Remainder uncertain");
		expect(html).not.toContain("Posted");
		expect(html).not.toContain("Diagnostic movement");
	});
});
