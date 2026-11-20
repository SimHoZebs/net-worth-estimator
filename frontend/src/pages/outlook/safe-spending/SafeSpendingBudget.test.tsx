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
				cycleFundingPayday: "2026-11-27",
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
		expect(html).toContain("Without cash cushion · $595.52");
		expect(html).toContain("After savings goal · $95.52");
		expect(html).toContain("Monthly savings goal (set aside) · $500.00");
		expect(html).toContain("Cash cushion · $300.92");
		expect(html).not.toContain("—");
	});

	it("labels the funding paycheck from the cycle field, not the next income", () => {
		const html = render();
		expect(html).toContain(
			'<time dateTime="2026-11-27">Nov 27</time> paycheck',
		);
		expect(html).not.toContain("Nov 30 paycheck");
		expect(html).toContain("Resets in 3 days");
		expect(html).toContain('<time dateTime="2026-11-20">Nov 20</time>');
		expect(html).toContain("Bills and payments by");
		expect(html).toContain('by <time dateTime="2026-12-30">Dec 30</time>');
		expect(html).not.toContain("Nov 30 paycheck · Dec 30");
	});

	it("shows no funding date when the active cycle has none", () => {
		const html = render(500, { cycleFundingPayday: null });
		expect(html).not.toContain("paycheck");
		expect(html).toContain('data-testid="with-cash-cushion">$896.44');
	});

	it("renders the same cycle amounts regardless of the cash checkpoint", () => {
		const withCheckpoint = render(500);
		const withoutCheckpoint = render(500, { safeToSpend: 300.92 });
		for (const markup of [withCheckpoint, withoutCheckpoint]) {
			expect(markup).toContain('data-testid="with-cash-cushion">$896.44');
			expect(markup).toContain("Without cash cushion · $595.52");
			expect(markup).toContain("After savings goal · $95.52");
		}
		// The immediate cash checkpoint stays in the detail view, not here.
		expect(withCheckpoint).not.toContain("Immediate cash checkpoint");
		expect(withCheckpoint).not.toContain('data-testid="safe-to-spend"');
	});

	it("shows a short status on the unknown primary while known siblings stay visible", () => {
		const html = render(500, {
			fundingRoom: null,
			incomeFunded: 595.52,
			savingsAllowance: 95.52,
			checkingAvailable: null,
		});
		expect(html).toContain(
			'data-testid="with-cash-cushion">Cash balance missing',
		);
		expect(html).toContain('data-testid="income-funded">+$595.52');
		expect(html).toContain('data-testid="savings-allowance">+$95.52');
		expect(html).not.toContain("—");
	});

	it("does not blame the next payment for missing active-cycle totals", () => {
		const html = render(500, {
			fundingRoom: null,
			incomeFunded: null,
			savingsAllowance: null,
			expectedPay: null,
			statementReserve: null,
		});
		expect(html).not.toContain("Next paycheck unknown");
		expect(html).not.toContain("Next card payoff unverified");
	});

	it("renders a proven zero as $0.00 and never as a status", () => {
		const html = render(500, {
			fundingRoom: 0,
			incomeFunded: 0,
			savingsAllowance: 0,
			additionalSavings: 0,
		});
		for (const testId of [
			"with-cash-cushion",
			"income-funded",
			"savings-allowance",
		]) {
			expect(html).toContain(`data-testid="${testId}">$0.00`);
		}
		expect(html).not.toContain('data-testid="with-cash-cushion">Unavailable');
		expect(html).not.toContain('data-testid="income-funded">Unavailable');
	});

	it("labels negative cycle amounts with direction and a positive magnitude", () => {
		const html = render(500, {
			fundingRoom: -110,
			incomeFunded: -110,
			savingsAllowance: -610,
			additionalSavings: -110,
			nextCycleDiscretionary: -80,
			nextCycleIncome: -180,
			nextCycleCarryover: 100,
			forecastCashRoom: -50,
		});
		expect(html).toContain('data-testid="with-cash-cushion">Over by $110.00');
		expect(html).toContain('data-testid="income-funded">Over by $110.00');
		expect(html).toContain('data-testid="savings-allowance">Short by $610.00');
		expect(html).not.toContain("Additional savings");
		expect(html).toContain(
			'data-testid="discretionary-next-cycle">Over by $80.00',
		);
		expect(html).toContain('data-testid="next-cycle-income">Over by $180.00');
		expect(html).toContain('data-testid="next-cycle-carryover">$100.00');
		expect(html).toContain("Short by $50.00 before a scheduled payment");
		expect(html).not.toContain("−$");
	});

	it("keeps cycle amounts independent of the displayed dates", () => {
		const first = render();
		const second = render(500, {
			cashAsOf: "2026-10-01",
			payday: "2026-12-15",
			cycleFundingPayday: "2026-12-12",
			payoffDate: "2027-01-30",
			cycleReset: "2026-12-20",
			nextCycleEnd: "2027-01-19",
		});
		for (const testId of ["with-cash-cushion", "discretionary-next-cycle"]) {
			const value = (markup: string) =>
				markup
					.match(
						new RegExp(`data-testid="${testId}"[^>]*>([\\s\\S]*?)</span>`),
					)?.[1]
					?.replace(/<[^>]+>/g, "");
			expect(value(second)).toBe(value(first));
		}
		for (const testId of ["income-funded", "savings-allowance"]) {
			const value = (markup: string) =>
				markup
					.match(
						new RegExp(`data-testid="${testId}"[^>]*>([\\s\\S]*?)</li>`),
					)?.[1]
					?.replace(/<[^>]+>/g, "")
					.trim();
			expect(value(second)).toBe(value(first));
			expect(value(first)).not.toBe("");
		}
	});

	it("draws the full funding room as additive segments with a cash-cushion boundary", () => {
		const html = render();
		expect(html).toContain('data-testid="cycle-budget-graph"');
		expect(html).toContain(
			'aria-label="With cash cushion $896.44. After savings goal $95.52. Monthly savings goal (set aside) $500.00. Cash cushion $300.92. Without cash cushion $595.52."',
		);
		const widths = [...html.matchAll(/--segment-width:([0-9.]+)%/g)].map(
			(match) => Number(match[1]),
		);
		expect(widths).toHaveLength(3);
		expect(widths[0]).toBeCloseTo((95.52 / 896.44) * 100, 6);
		expect(widths[1]).toBeCloseTo((500 / 896.44) * 100, 6);
		expect(widths[2]).toBeCloseTo((300.92 / 896.44) * 100, 6);
		expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
		const boundary = Number(
			html.match(/data-boundary-marker="true" style="left:([0-9.]+)%/)?.[1],
		);
		expect(boundary).toBeCloseTo((595.52 / 896.44) * 100, 6);
		expect(html).not.toContain("After savings goal ($500.00 goal)");
	});

	it("renders next-cycle funding as a bar with exact-value legend and text alternative", () => {
		const html = render(500, {
			nextCycleIncome: 3486.08,
			nextCycleCarryover: 896.44,
			nextCycleDiscretionary: 4382.52,
		});
		expect(html).toContain('data-testid="discretionary-next-cycle">$4,382.52');
		expect(html).toContain(
			'aria-label="Next cycle funding: From income $3,486.08. Cash carried forward $896.44."',
		);
		expect(html).toContain('data-testid="next-cycle-income"');
		expect(html).toContain("From income · $3,486.08");
		expect(html).toContain('data-testid="next-cycle-carryover"');
		expect(html).toContain("Cash carried forward · $896.44");
		expect(html).toContain('data-tone="sage" data-pattern="solid"');
		expect(html).toContain('data-tone="plum" data-pattern="solid"');
		expect(html).not.toContain("Additional savings");
		const widths = [...html.matchAll(/--segment-width:([0-9.]+)%/g)].map(
			(match) => Number(match[1]),
		);
		expect(widths).toHaveLength(5);
		expect(widths[3]).toBeCloseTo((3486.08 / 4382.52) * 100, 6);
		expect(widths[4]).toBeCloseTo((896.44 / 4382.52) * 100, 6);
	});

	it("omits a zero savings goal and a zero cash cushion from the bar", () => {
		const noGoal = render(0, { savingsAllowance: 595.52 });
		expect(noGoal).toContain('data-testid="cycle-budget-graph"');
		expect(noGoal).toContain('data-testid="savings-allowance"');
		expect(noGoal).not.toContain('data-testid="savings-target"');
		expect(noGoal).toContain('data-testid="cash-cushion"');

		const noCushion = render(500, {
			fundingRoom: 595.52,
			incomeFunded: 595.52,
			savingsAllowance: 95.52,
		});
		expect(noCushion).toContain('data-testid="cycle-budget-graph"');
		expect(noCushion).toContain('data-testid="savings-target"');
		expect(noCushion).not.toContain('data-testid="cash-cushion"');
	});

	for (const [name, overrides] of [
		["missing funding room", { fundingRoom: null, checkingAvailable: null }],
		[
			"shortfall",
			{ fundingRoom: -110, incomeFunded: -110, savingsAllowance: -610 },
		],
		["negative cash cushion", { fundingRoom: 500, incomeFunded: 595.52 }],
		["inconsistent totals", { savingsAllowance: 100 }],
	] as const) {
		it(`falls back to the signed amount rows for ${name}`, () => {
			const html = render(500, overrides);
			expect(html).not.toContain('data-testid="cycle-budget-graph"');
			expect(html).toContain('data-testid="with-cash-cushion"');
			expect(html).toContain('data-testid="income-funded"');
			expect(html).toContain('data-testid="savings-allowance"');
		});
	}
});
