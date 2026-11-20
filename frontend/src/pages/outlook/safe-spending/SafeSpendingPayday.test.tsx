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
				statementReserve: 30,
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
				],
				statements: [
					{
						accountId: "card",
						name: "Card",
						closingDate: "2026-12-30",
						kind: "estimated",
						amount: 30,
					},
				],
				...overrides,
			})}
		/>,
	);

describe("safe spending payday section", () => {
	it("shows a payoff status when the reserve is unknown while siblings stay numeric", () => {
		const html = render({ statementReserve: null });
		expect(html).toContain("Payoff unverified");
		expect(html).toContain('data-testid="paid-by-payday">$100.00');
		expect(html).toContain('data-testid="unpaid-by-payday">$50.00');
		expect(html).toContain("Payment unverified");
		expect(html).not.toContain("—");
	});

	it("renders a proven zero reserve as $0.00", () => {
		expect(render({ statementReserve: 0 })).toContain("$0.00");
	});
});
