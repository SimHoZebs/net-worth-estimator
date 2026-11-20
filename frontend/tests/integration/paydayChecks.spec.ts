import { expect, request, test, type Page } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const headline = {
	cycleReset: "2026-11-20",
	daysUntilReset: 3,
	safeToSpend: 300.92,
	incomeFunded: 595.52,
	savingsAllowance: 95.52,
	additionalSavings: 595.52,
	fundingRoom: 896.44,
	payday: "2026-11-28",
	cycleFundingPayday: "2026-11-27",
	payoffDate: "2026-11-30",
	paymentPeriodStart: "2026-10-31",
	paidByPayday: 175,
	unpaidByPayday: 4054.65,
	statementReserve: 2890.56,
	nextCycleEnd: "2026-12-19",
	nextCycleDiscretionary: 4382.52,
	nextCycleIncome: 3486.08,
	nextCycleCarryover: 896.44,
	forecastCashRoom: -20,
	bills: [
		{
			id: "rent",
			date: "2026-10-28",
			actualDate: "2026-11-02",
			status: "paid",
			name: "Synthetic rent",
			amount: 175,
		},
	],
	statements: [
		{
			accountId: "card",
			name: "Synthetic card",
			closingDate: "2026-11-19",
			kind: "estimated",
			amount: 2890.56,
		},
	],
};

async function overrideSummary(
	page: Page,
	patch: Record<string, unknown> = {},
) {
	await page.route("**/v1/safe-spending-summary", async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			json: { ...(await response.json()), ...headline, ...patch },
		});
	});
}

async function setSavingsTarget(savingsTarget: number) {
	const api = await request.newContext();
	try {
		const response = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
			data: {
				cycleStartDay: 20,
				paydayDay: 30,
				savingsTarget,
				accountIds: null,
				spendingAccountIds: null,
				incomeScheduleIds: [],
				transactionIds: null,
			},
		});
		expect(response.ok(), await response.text()).toBe(true);
	} finally {
		await api.dispose();
	}
}

test("safe spending separates immediate room, progress, and next-cycle funding", async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await overrideSummary(page);
	await setSavingsTarget(500);
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(
		card.getByRole("heading", { name: "Cycle budget" }),
	).toBeVisible();
	await expect(card.getByText("Nov 27 paycheck")).toBeVisible();
	await expect(card.getByTestId("with-cash-cushion")).toHaveText("$896.44");
	await expect(card.getByText("Resets in 3 days")).toBeVisible();
	await expect(card.getByTestId("cycle-budget-graph")).toBeVisible();
	await expect(card.getByTestId("income-funded")).toHaveText(
		"Without cash cushion · $595.52",
	);
	await expect(card.getByTestId("savings-allowance")).toHaveText(
		"After savings goal · $95.52",
	);
	await expect(card.getByTestId("savings-target")).toHaveText(
		"Monthly savings goal (set aside) · $500.00",
	);
	await expect(card.getByTestId("cash-cushion")).toHaveText(
		"Cash cushion · $300.92",
	);
	await expect(
		card.getByRole("img", {
			name: "With cash cushion $896.44. After savings goal $95.52. Monthly savings goal (set aside) $500.00. Cash cushion $300.92. Without cash cushion $595.52.",
		}),
	).toBeVisible();
	const bar = card.getByTestId("cycle-budget-graph").getByRole("img");
	const widths = await bar
		.locator("[data-tone]")
		.evaluateAll((nodes) =>
			nodes.map((node) =>
				Number.parseFloat(
					(node as HTMLElement).style.getPropertyValue("--segment-width"),
				),
			),
		);
	expect(widths).toHaveLength(3);
	expect(widths[0]).toBeCloseTo((95.52 / 896.44) * 100, 6);
	expect(widths[1]).toBeCloseTo((500 / 896.44) * 100, 6);
	expect(widths[2]).toBeCloseTo((300.92 / 896.44) * 100, 6);
	const boundaryLeft = await card
		.locator("[data-boundary-marker]")
		.evaluate((node) => Number.parseFloat((node as HTMLElement).style.left));
	expect(boundaryLeft).toBeCloseTo((595.52 / 896.44) * 100, 3);
	await expect(card.getByText("After savings goal ($500.00 goal)")).toHaveCount(
		0,
	);
	await expect(
		card.getByRole("heading", { name: "Bills and payments by Nov 30" }),
	).toBeVisible();
	await expect(card.getByTestId("payment-progress")).toBeVisible();
	await expect(card.getByTestId("unpaid-by-payday")).toHaveText("$4,054.65");
	await expect(card.getByTestId("next-cycle-composition")).toBeVisible();
	await expect(
		card.getByText("Short by $20.00 before a scheduled payment"),
	).toBeVisible();
	await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
		"$4,382.52",
	);
	await expect(card.getByTestId("next-cycle-carryover")).toHaveText("$896.44");
	await expect(card.getByTestId("cash-on-hand")).toHaveCount(0);

	const paymentDetails = card
		.locator("summary")
		.filter({ hasText: "Payment details" });
	const cardDetails = card
		.locator("summary")
		.filter({ hasText: "Credit cards to pay" });
	await expect(cardDetails).toContainText("Nov 30");
	await expect(cardDetails).toContainText("$2,890.56");
	await expect(card.getByText("Synthetic rent")).toBeHidden();
	await expect(card.getByText("Synthetic card")).toBeHidden();
	await paymentDetails.focus();
	await page.keyboard.press("Enter");
	await expect(card.getByText("Synthetic rent")).toBeVisible();
	await expect(card.getByText("Synthetic card")).toBeHidden();
	await expect(card.getByText("Nov 2", { exact: true })).toBeVisible();
	await cardDetails.click();
	await expect(card.getByText("Synthetic card")).toBeVisible();
	await expect(card.getByText("Synthetic rent")).toBeVisible();
	expect(await card.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
		await card.evaluate((node) => node.clientWidth),
	);
});

test("an unknown cycle funding payday stays undated without hiding payment or income details", async ({
	page,
}) => {
	await overrideSummary(page, { cycleFundingPayday: null });
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(card.getByText(/Nov 27 paycheck|Nov 28 paycheck/)).toHaveCount(
		0,
	);
	await expect(card.getByTestId("payment-progress")).toBeVisible();
	await expect(
		card.getByRole("heading", { name: "Bills and payments by Nov 30" }),
	).toBeVisible();
	await card.getByRole("button", { name: /Protected obligations ·/ }).click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	await expect(drawer.getByText("Next income · Nov 28, 2026")).toBeVisible();
	await expect(
		drawer.getByRole("region", { name: "Cash checks" }),
	).toBeVisible();
	await expect(
		drawer.getByText(/Payment capacity|Payments covered/),
	).toBeVisible();
});

test("missing and negative amounts leave independently known evidence visible", async ({
	page,
}) => {
	await overrideSummary(page, {
		fundingRoom: null,
		checkingAvailable: null,
		reasons: ["possible-pending-payment-overlap"],
		incomeFunded: -110,
		savingsAllowance: -610,
		additionalSavings: -110,
		unpaidByPayday: null,
		nextCycleDiscretionary: -80,
		nextCycleIncome: -180,
		nextCycleCarryover: 100,
	});
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(card.getByTestId("with-cash-cushion")).toHaveText(
		"Cash balance missing",
	);
	await expect(
		card.getByText("Possible pending payment overlap"),
	).toBeVisible();
	await expect(card.getByTestId("income-funded")).toHaveText("Over by $110.00");
	await expect(card.getByTestId("savings-allowance")).toHaveText(
		"Short by $610.00",
	);
	await expect(card.getByTestId("additional-savings")).toHaveText(
		"Uses $110.00 from your cushion",
	);
	await expect(card.getByTestId("paid-by-payday")).toHaveText("$175.00");
	await expect(card.getByTestId("unpaid-by-payday")).toHaveText("Unavailable");
	await expect(card.getByTestId("payment-progress")).toHaveCount(0);
	await expect(card.getByTestId("next-cycle-composition")).toHaveCount(0);
	await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
		"Over by $80.00",
	);
});

test("monthly budget uses native validation and saves all three fields", async ({
	page,
}) => {
	await overrideSummary(page);
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(card.getByTestId("with-cash-cushion")).toBeVisible();
	await card.getByRole("button", { name: "Configure" }).click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	const start = drawer.getByLabel("Cycle start day");
	const payday = drawer.getByLabel("Payday of month");
	const target = drawer.getByLabel("Monthly savings goal ($)");
	const save = drawer.getByRole("button", { name: "Save monthly budget" });
	await start.fill("32");
	await save.click();
	await expect(start).toBeFocused();
	expect(
		await start.evaluate(
			(input: HTMLInputElement) => input.validity.rangeOverflow,
		),
	).toBe(true);
	await start.fill("21");
	await payday.fill("29");
	await target.fill("500");
	const saved = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
			response.request().method() === "PUT",
	);
	await save.click();
	const response = await saved;
	expect(response.ok()).toBe(true);
	expect(response.request().postDataJSON()).toMatchObject({
		cycleStartDay: 21,
		paydayDay: 29,
		savingsTarget: 500,
	});
	await page.keyboard.press("Escape");
	await expect(card.getByTestId("cycle-budget-graph")).toBeVisible();
	await expect(card.getByTestId("savings-target")).toHaveText(
		"Monthly savings goal (set aside) · $500.00",
	);
	await expect(card.getByText("After savings goal ($500.00 goal)")).toHaveCount(
		0,
	);
});
