import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";
import { SafeSpendingPayday } from "./SafeSpendingPayday.tsx";

const render = (overrides = {}) =>
	renderToStaticMarkup(
		<SafeSpendingPayday
			summary={summaryFixture({
				payoffDate: "2026-12-30",
				paymentPeriodStart: "2026-10-31",
				paidByPayday: 100,
				unpaidByPayday: 50,
				bills: [
					{
						id: "bill",
						actualDate: null,
						transactionId: null,
						scheduleId: null,
						accountId: "checking",
						name: "Unverified bill",
						date: "2026-11-25",
						amount: 25,
						status: "unknown",
					},
					{
						id: "paid-bill",
						actualDate: "2026-11-02",
						transactionId: null,
						scheduleId: null,
						accountId: "checking",
						name: "Paid rent",
						date: "2026-11-01",
						amount: 175,
						status: "paid",
					},
				],
				...overrides,
			})}
		/>,
	);

describe("safe spending payday section", () => {
	it("renders exact-value legend and text alternative for the payment bar", () => {
		const html = render();
		expect(html).toContain('role="img"');
		expect(html).toContain(
			'aria-label="Payment progress: Already paid $100.00. Still to pay $50.00."',
		);
		expect(html).toContain('data-testid="paid-by-payday"');
		expect(html).toContain("Already paid · $100.00");
		expect(html).toContain("Still to pay · $50.00");
		expect(html).toContain('data-tone="sage" data-pattern="solid"');
		expect(html).toContain('data-tone="tan" data-pattern="dots"');
	});

	it("keeps the numeric rows when the split is unknown", () => {
		const html = render({ unpaidByPayday: null });
		expect(html).toContain('data-testid="paid-by-payday">$100.00');
		expect(html).toContain('data-testid="unpaid-by-payday">Unavailable');
		expect(html).not.toContain("Payment progress:");
	});

	it("lists only unpaid bills in the payment details", () => {
		const html = render();
		expect(html).toContain("Unverified bill");
		expect(html).not.toContain("Paid rent");
	});
});
