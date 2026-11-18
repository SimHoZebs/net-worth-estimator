import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import type { TransactionResult } from "@/domain/result.ts";
import type { Transaction } from "@/domain/model.ts";
import {
	recurringBillMarkers,
	unclaimedBills,
} from "@/domain/recurringBillIncreases.ts";
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
				name: "Backend obligation not shown as bill",
				date: "2026-11-15",
				amount: 711.12,
				status: "outstanding",
			},
		],
		...overrides,
	};
}

const bill = (
	overrides: Partial<TransactionResult> = {},
): TransactionResult => ({
	date: "2026-11-15",
	transactionId: "bill-a",
	name: "Selected bill A",
	requested: 711.12,
	realized: 711.12,
	fromId: "checking",
	toId: null,
	available: null,
	constraint: null,
	accountDeltas: [],
	posted: false,
	...overrides,
});

const render = (
	data: SafeSpendingSummary,
	bills: readonly TransactionResult[] = [],
) =>
	renderToStaticMarkup(
		<SafeSpendingCashEvidence
			summary={data}
			bills={bills}
			pending={false}
			error={false}
			onRetry={() => {}}
		/>,
	);

describe("safe spending cash evidence", () => {
	it("renders the exact server cash fact and bills from the selected-cycle bill rows", () => {
		const html = render(summary(), [
			bill(),
			bill({
				transactionId: "bill-b",
				name: "Selected bill B",
				date: "2026-11-20",
				requested: 98.92,
			}),
		]);
		expect(html).toContain("-$216.58");
		expect(html).toMatch(
			/class="[^"]*text-danger-text[^"]*" data-testid="left-value"/,
		);
		expect(html).toContain("Bills</h3>");
		expect(html).toContain("$810.04");
		expect(html).toContain("Selected bill A");
		expect(html).toContain("Selected bill B");
		expect(html).toContain("Nov 15");
		expect(html).toContain("Nov 20");
		expect(html).toContain('aria-label="Bills in this cycle"');
		expect(html).not.toContain("Backend obligation not shown as bill");
		expect(html).not.toContain("$1,461.01");
		expect(html).toContain("$1,244.43");
		expect(html).not.toContain("close-cash-value");
		expect(html).not.toContain("Available cash at close");
		expect(html).not.toContain("No balance recorded at close");
	});
	it("withholds the total and list when no bills are selected in the cycle", () => {
		const html = render(summary());
		expect(html).toContain("Bills</h3>");
		expect(html).toContain('data-testid="left-value">-$216.58');
		expect(html).toContain("No bills.");
		expect(html).not.toContain("$711.12");
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
	it("renders a past single-day close range with the same cash figure and bills", () => {
		const html = render(
			summary({
				start: "2026-10-19",
				end: "2026-10-19",
				cashAfterBills: 450.25,
				outstandingBillsTotal: 100,
				checkingAvailable: 450.25,
			}),
			[bill()],
		);
		expect(html).toContain("$450.25");
		expect(html).toContain('data-testid="left-value"');
		expect(html).not.toContain("Backend obligation not shown as bill");
		expect(html).not.toContain("close-cash-value");
		expect(html).not.toContain("Available cash at close");
		expect(html).not.toContain("No balance recorded at close");
		expect(html).toContain("Selected bill A");
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
	it("renders a future single-day range with the same unavailable allowance state", () => {
		const html = render(
			summary({
				start: "2026-12-19",
				end: "2026-12-19",
				status: "missing",
				cashAfterBills: null,
				outstandingBillsTotal: null,
				checkingAvailable: null,
				baselines: [],
			}),
			[bill()],
		);
		expect(html).toContain('data-testid="left-value">—');
		expect(html).toContain("Remainder unavailable");
		expect(html).toContain("Bills</h3>");
		expect(html).toContain("Selected bill A");
		expect(html).not.toContain("close-cash-value");
		expect(html).not.toContain(
			"No cash evidence exists for an upcoming cycle.",
		);
	});
	it("renders a contractually unfetchable window with the same unavailable figure", () => {
		// Future ranges cannot be fetched (the endpoint rejects starts after
		// today), so the caller disables the query and the component renders
		// the explicit unavailable state instead of loading or erroring.
		const html = renderToStaticMarkup(
			<SafeSpendingCashEvidence
				summary={undefined}
				bills={[bill()]}
				pending={false}
				error={false}
				unavailable
				onRetry={() => {}}
			/>,
		);
		expect(html).toContain('data-testid="left-value">—');
		expect(html).toContain("Remainder unavailable");
		expect(html).toContain("Bills</h3>");
		expect(html).toContain("Selected bill A");
		expect(html).not.toContain("Loading cash evidence");
		expect(html).not.toContain("could not be loaded");
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
	it("hides a claimed occurrence from the Bills list while markers keep its dot", () => {
		const full = [
			bill(),
			bill({
				transactionId: "bill-b",
				name: "Selected bill B",
				date: "2026-11-20",
				requested: 98.92,
			}),
		];
		const paid: Transaction = {
			id: "paid-1",
			name: "Recorded payment for bill A",
			amount: 711.12,
			amountKnown: true,
			fromId: "checking",
			toId: null,
			kind: "transaction",
			startDate: "2026-11-15",
			endDate: null,
			annualIncrease: 0,
			enabled: true,
			readOnly: false,
			claimScheduleId: "bill-a",
			claimOccurrenceDate: "2026-11-15",
			postedDate: null,
			pending: false,
			void: false,
			syncOwned: true,
			category: null,
			categorySource: null,
			transactionTime: null,
		};
		// The preview passes the unclaimed list to the Bills section while
		// the chart keeps markers from the full selected-cycle set.
		const display = unclaimedBills(full, [paid]);
		expect(display.map((row) => row.transactionId)).toEqual(["bill-b"]);
		expect(recurringBillMarkers(full)).toEqual([
			{ date: "2026-11-15", amount: 711.12, name: "Selected bill A" },
			{ date: "2026-11-20", amount: 98.92, name: "Selected bill B" },
		]);
		const html = render(summary(), display);
		expect(html).toContain("Selected bill B");
		expect(html).toContain("$98.92");
		expect(html).not.toContain("Selected bill A");
		expect(html).not.toContain("$810.04");
	});
});
