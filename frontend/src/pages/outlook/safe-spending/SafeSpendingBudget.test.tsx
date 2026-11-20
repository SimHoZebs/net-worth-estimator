import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";
import { SafeSpendingBudget } from "./SafeSpendingBudget.tsx";

const render = (savingsTarget = 500, overrides = {}) =>
	renderToStaticMarkup(
		<SafeSpendingBudget
			summary={summaryFixture({
				cashAsOf: "2026-11-17",
				payday: "2026-11-30",
				payoffDate: "2026-12-30",
				cycleReset: "2026-11-20",
				daysUntilReset: 3,
				checkingAvailable: 300.92,
				expectedPay: 7449.65,
				statementReserve: 2890.56,
				fundingRoom: 896.44,
				incomeFunded: 595.52,
				savingsAllowance: 95.52,
				additionalSavings: 595.52,
				reserve: 725,
				...overrides,
			})}
			savingsTarget={savingsTarget}
		/>,
	);

describe("safe spending cycle budget", () => {
	it("shows the three cycle amounts with clear headings", () => {
		const html = render();
		expect(html).toContain("Cycle budget");
		expect(html).toContain("With cash cushion");
		expect(html).toContain('data-testid="with-cash-cushion">$896.44');
		expect(html).toContain("Without cash cushion");
		expect(html).toContain('data-testid="income-funded">+$595.52');
		expect(html).toContain("After savings goal ($500.00 goal)");
		expect(html).toContain('data-testid="savings-allowance">+$95.52');
	});

	it("labels the funding paycheck separately from the reset and bank payment dates", () => {
		const html = render();
		expect(html).toContain(
			'<time dateTime="2026-11-30">Nov 30</time> paycheck',
		);
		expect(html).toContain("Resets in 3 days");
		expect(html).toContain('<time dateTime="2026-11-20">Nov 20</time>');
		expect(html).toContain("Bills and payments by");
		expect(html).toContain('by <time dateTime="2026-12-30">Dec 30</time>');
		expect(html).not.toContain("Nov 30 paycheck · Dec 30");
	});

	it("renders the three values from the wire fields without reserve math", () => {
		const withReserve = render(500);
		const withoutReserve = render(500, { reserve: 0, safeToSpend: 300.92 });
		for (const markup of [withReserve, withoutReserve]) {
			expect(markup).toContain('data-testid="with-cash-cushion">$896.44');
			expect(markup).toContain('data-testid="income-funded">+$595.52');
			expect(markup).toContain('data-testid="savings-allowance">+$95.52');
		}
		// The reserve-bounded checkpoint stays in the detail view, not here.
		expect(withReserve).not.toContain("Immediate cash checkpoint");
		expect(withReserve).not.toContain('data-testid="safe-to-spend"');
	});

	it("keeps unknown values independent", () => {
		const html = render(500, {
			fundingRoom: null,
			incomeFunded: -110,
			savingsAllowance: -610,
			checkingAvailable: null,
		});
		expect(html).toContain("Available cash unverified");
		expect(html).toContain('data-testid="with-cash-cushion">—');
		expect(html).toContain('data-testid="income-funded">Over by $110.00');
		expect(html).toContain(
			'data-testid="savings-allowance">Short of goal by $610.00',
		);
	});
});
