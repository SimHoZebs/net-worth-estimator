import AxeBuilder from "@axe-core/playwright";
import { expect, test, trackBrowserErrors, type Locator } from "./base.ts";
import { FIXTURE_API, resetFixture } from "./fixture.ts";
import { SAFE_SPENDING_LABELS as labels } from "../../src/pages/outlook/safe-spending/safeSpendingLabels.ts";

test.beforeEach(async ({ page, request }) => {
	await resetFixture();
	await page.clock.setFixedTime(new Date("2026-01-31T12:00:00Z"));
	// Make salary current, rather than a future-start rule, without changing
	// any projected amounts after the January balance checkpoint.
	const response = await request.post(
		`${FIXTURE_API}/v1/schedules/salary/reschedule`,
		{ data: { startDate: "2026-01-01" } },
	);
	expect((await response.json()).saved).toBe(true);
});

test("Configure settings survive in a fresh browser context", async ({
	page,
	browser,
	request,
}) => {
	await page.goto("/#outlook/safe-spending-detail/configure");
	await expect(
		page
			.getByRole("dialog", { name: "Safe card spending" })
			.getByRole("heading", { name: "Safe card spending" }),
	).toBeVisible();
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/v1/safe-spending-settings") &&
			response.request().method() === "PUT" &&
			response.request().postDataJSON().reserve === 321,
	);
	await page.getByLabel(`${labels.reserve} ($)`, { exact: true }).fill("321");
	expect((await saved).ok()).toBe(true);
	const settings = await request.get(
		`${FIXTURE_API}/v1/safe-spending-settings`,
	);
	expect((await settings.json()).settings.reserve).toBe(321);
	const fresh = await browser.newContext();
	const reportFreshErrors = trackBrowserErrors(fresh);
	try {
		const otherPage = await fresh.newPage();
		await otherPage.goto(page.url());
		await expect(
			otherPage.getByLabel(`${labels.reserve} ($)`, { exact: true }),
		).toHaveValue("321");
		await expect(
			otherPage
				.getByRole("dialog", { name: "Safe card spending" })
				.getByRole("heading", { name: "Safe card spending" }),
		).toBeVisible();
		reportFreshErrors();
	} finally {
		await fresh.close();
	}
});

test("household budget shows paycheck allocation and one sortable cycle bill list", async ({
	page,
	request,
}) => {
	const checkpoint = await request.post(`${FIXTURE_API}/v1/checkpoints`, {
		data: { AccountId: "loan", Balance: -4321, observedAt: 1768867199 },
	});
	expect(checkpoint.ok()).toBe(true);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/#outlook/safe-spending-detail");
	const drawer = page.getByRole("dialog");
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	await page
		.getByRole("group", { name: "Income sources" })
		.getByRole("button", { name: /^Salary/ })
		.click();
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(page.getByRole("tab", { name: /This cycle/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("tab", { name: "Bills", exact: true }),
	).toHaveCount(0);
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(
		drawer.getByText("Dec 20, 2025 – Jan 19, 2026", { exact: true }),
	).toHaveCount(1);
	await expect(
		drawer.getByRole("region", { name: labels.cashAfterBills }),
	).toContainText("The Feb 1 paycheck paid this statement");
	await expect(
		drawer.getByRole("region", { name: labels.allowance, exact: true }),
	).toContainText("-$4,696");
	await expect(
		drawer.getByRole("list", { name: labels.closedCardBalances }),
	).toContainText("$4,321");
	await expect(
		drawer.getByText(labels.billsThisCycle, { exact: true }),
	).toBeVisible();
	await expect(drawer.getByText("No bills due in this period.")).toBeVisible();
	await expect(
		drawer.getByRole("region", { name: "Paycheck allocation" }),
	).toHaveCount(0);
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(
		drawer.getByText("Jan 20, 2026 – Feb 19, 2026", { exact: true }),
	).toHaveCount(1);
	await expect(drawer.getByRole("list", { name: / details$/ })).toHaveCount(0);
	await expect(
		drawer.getByRole("list", { name: labels.closedCardBalances }),
	).toHaveCount(0);
	await expect(
		drawer.getByRole("toolbar", { name: "Bills window" }),
	).toHaveCount(0);
	await expect(
		drawer.getByRole("button", { name: "Calendar month" }),
	).toHaveCount(0);
	const bills = drawer.getByRole("table", {
		name: new RegExp(labels.scheduledBills),
	});
	await expect(bills.locator("tbody tr")).toHaveCount(3);
	await expect(
		drawer.getByText("Housing and living", { exact: true }),
	).toHaveCount(1);
	await expect(bills).not.toContainText("Student loan payment");
	await expect(bills.locator("tbody tr").first()).toContainText(
		"Retirement contribution",
	);
	await drawer
		.getByRole("button", { name: /Sort transactions:/ })
		.first()
		.click();
	await expect(bills.locator("tbody tr").first()).toContainText(
		"Housing and living",
	);
	await bills.getByRole("button", { name: /View Housing and living/ }).click();
	await expect(page.getByRole("dialog").last()).toContainText(
		"Housing and living",
	);
	await page.keyboard.press("Escape");
	await expect(drawer).toBeVisible();
	expect(errors).toEqual([]);
});

test("last-cycle and this-cycle tabs keep histories separate and support keyboard navigation and reload", async ({
	page,
	request,
}) => {
	const observations = await request.post(`${FIXTURE_API}/v1/checkpoints`, {
		data: { AccountId: "loan", Balance: -4321, observedAt: 1768867199 },
	});
	expect(observations.ok()).toBe(true);
	for (const [id, name, day, amount] of [
		[
			"01900000-0000-7000-8000-000000000031",
			"Prior cycle purchase",
			"2026-01-10",
			50,
		],
		[
			"01900000-0000-7000-8000-000000000032",
			"Current cycle purchase",
			"2026-01-25",
			25,
		],
	] as const) {
		const response = await request.post(`${FIXTURE_API}/v1/transactions`, {
			data: {
				id,
				name,
				sourceAccountId: "loan",
				destinations: null,
				amount: { value: amount },
				date: day,
				enabled: true,
			},
		});
		expect(response.ok()).toBe(true);
		expect((await response.json()).saved).toBe(true);
	}
	await page.goto("/#outlook/safe-spending-detail/cycle");
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(page).toHaveURL(/safe-spending-detail\/last-cycle$/);
	const last = page.getByRole("dialog", {
		name: "Safe card spending",
		exact: true,
	});
	await expect(
		last.getByRole("list", { name: labels.closedCardBalances }),
	).toContainText("$4,321");
	const lastCharges = last.getByRole("table", {
		name: new RegExp(labels.recordedCharges),
	});
	await expect(lastCharges).toContainText("Prior cycle purchase");
	await expect(lastCharges).not.toContainText("Current cycle purchase");
	await page.getByRole("tab", { name: /Last cycle/ }).press("ArrowLeft");
	const currentTab = page.getByRole("tab", { name: /This cycle/ });
	await expect(currentTab).toBeFocused();
	await expect(currentTab).toHaveAttribute("aria-selected", "true");
	await expect(
		page.getByRole("list", { name: labels.closedCardBalances }),
	).toHaveCount(0);
	await expect(
		page.getByRole("dialog").getByText(labels.allowance, { exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(/safe-spending-detail\/cycle$/);
	const currentCharges = page.getByRole("table", {
		name: new RegExp(labels.cycleSpending),
	});
	await expect(currentCharges).toContainText("Current cycle purchase");
	await expect(currentCharges).not.toContainText("Prior cycle purchase");
	await page.reload();
	await expect(page.getByRole("tab", { name: /This cycle/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.goto("/#outlook/safe-spending-detail/last-cycle");
	await expect(page.getByRole("tab", { name: /Last cycle/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("table", { name: new RegExp(labels.recordedCharges) }),
	).toContainText("Prior cycle purchase");
	const accessibility = await new AxeBuilder({ page })
		.include("dialog")
		.analyze();
	expect(accessibility.violations).toEqual([]);
});

test("income sources combine independent recurrence rules and persist explicit deselection", async ({
	page,
	request,
}) => {
	const response = await request.post(`${FIXTURE_API}/v1/schedules`, {
		data: {
			id: "partner-income",
			name: "Partner take-home pay",
			sourceAccountId: "brokerage",
			destinations: ["checking"],
			amount: {
				resolver: "expression",
				config: { expression: "1400" },
				inputs: {},
			},
			frequency: "monthly",
			startDate: "2026-01-10",
			endDate: null,
			annualCap: null,
			priority: 4,
			enabled: true,
		},
	});
	expect((await response.json()).saved).toBe(true);
	await page.goto("/#outlook/safe-spending-detail/configure");
	const sources = page.getByRole("group", { name: "Income sources" });
	const salary = sources.getByRole("button", { name: /^Salary/ });
	const partner = sources.getByRole("button", {
		name: /^Partner take-home pay/,
	});
	await expect(salary).toBeVisible({ timeout: 30_000 });
	await expect(salary).toHaveAttribute("aria-pressed", "false");
	await expect(partner).toHaveAttribute("aria-pressed", "false");
	await salary.click();
	await partner.focus();
	const sourcesSaved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/v1/safe-spending-settings") &&
			response.request().method() === "PUT" &&
			response.request().postDataJSON().incomeScheduleIds.length === 2,
	);
	await page.keyboard.press("Space");
	expect((await sourcesSaved).ok()).toBe(true);
	await page.reload();
	await expect(salary).toHaveAttribute("aria-pressed", "true");
	await expect(partner).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("tab", { name: /This cycle/ }).click();
	// The cycle closes Feb 20 and settles from the March paychecks; the
	// March window includes the fixture's $9,000 Home renovation.
	await expect(
		page
			.getByRole("region", { name: labels.allowance, exact: true })
			.getByTestId("metric-value"),
	).toHaveText("-$7,975");
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(
		page.getByRole("region", { name: labels.cashAfterBills }),
	).toContainText("The Jan 29 – Feb 1 paychecks paid this statement");
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	await salary.click();
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(
		page.getByRole("region", { name: labels.cashAfterBills }),
	).toContainText("The Jan 29 paycheck paid this statement");
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	const deselectionSaved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/v1/safe-spending-settings") &&
			response.request().method() === "PUT" &&
			response.request().postDataJSON().incomeScheduleIds.length === 0,
	);
	await partner.click();
	expect((await deselectionSaved).ok()).toBe(true);
	await page.reload();
	await expect(salary).toHaveAttribute("aria-pressed", "false");
	await expect(partner).toHaveAttribute("aria-pressed", "false");
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(
		page
			.getByRole("region", { name: labels.allowance, exact: true })
			.getByTestId("metric-value"),
	).toHaveText("-$14,975");
});

test("marks the spending-limit and protected-reserve crossings and projects the pace", async ({
	page,
	request,
}) => {
	const partner = await request.post(`${FIXTURE_API}/v1/schedules`, {
		data: {
			id: "partner-income",
			name: "Partner take-home pay",
			sourceAccountId: "brokerage",
			destinations: ["checking"],
			amount: {
				resolver: "expression",
				config: { expression: "1400" },
				inputs: {},
			},
			frequency: "monthly",
			startDate: "2026-01-10",
			endDate: null,
			annualCap: null,
			priority: 4,
			enabled: true,
		},
	});
	expect((await partner.json()).saved).toBe(true);
	const settings = await request.put(
		`${FIXTURE_API}/v1/safe-spending-settings`,
		{
			data: {
				statementDay: 20,
				reserve: 725,
				accountIds: null,
				spendingAccountIds: null,
				incomeAccountIds: null,
				incomeScheduleIds: ["salary", "partner-income"],
				transactionIds: null,
				statementDaySet: false,
			},
		},
	);
	expect(settings.ok()).toBe(true);
	for (const [id, name, day, amount] of [
		[
			"01900000-0000-7000-8000-000000000041",
			"Cycle charge A",
			"2026-01-22",
			600,
		],
		[
			"01900000-0000-7000-8000-000000000042",
			"Cycle charge B",
			"2026-01-24",
			600,
		],
		[
			"01900000-0000-7000-8000-000000000043",
			"Cycle charge C",
			"2026-01-27",
			700,
		],
	] as const) {
		const response = await request.post(`${FIXTURE_API}/v1/transactions`, {
			data: {
				id,
				name,
				sourceAccountId: "loan",
				destinations: null,
				amount: { value: amount },
				date: day,
				enabled: true,
			},
		});
		expect(response.ok()).toBe(true);
		expect((await response.json()).saved).toBe(true);
	}
	await page.goto("/#outlook/safe-spending-detail/cycle");
	const drawer = page.getByRole("dialog", { name: "Safe card spending" });
	await expect(
		drawer.getByRole("heading", { name: labels.spendingPace }),
	).toBeVisible();
	await expect(drawer.getByText("Over limit · $158 a day")).toBeVisible();
	const chart = drawer.getByRole("img", { name: labels.spendingPace });
	await expect(chart).toBeVisible();
	expect(chart.locator("desc")).toContainText(
		"Spending is already over the spending limit.",
	);
	await expect(
		drawer.getByRole("list", { name: `${labels.spendingPace} legend` }),
	).toContainText("Spending so far");
	await expect(
		drawer.getByRole("list", { name: `${labels.spendingPace} legend` }),
	).toContainText("Projected at average rate");
	// The statement closes Feb 20 and settles from the March paychecks
	// (salary Mar 1 + partner Mar 10). March's committed outflows include
	// the fixture's $9,000 Home renovation (Mar 6), so the allowance and
	// both thresholds run negative: the chart draws no threshold rule and
	// the legend keeps only the spending lines.
	await expect(
		drawer.getByRole("list", { name: `${labels.spendingPace} legend` }),
	).not.toContainText(labels.reserveStarts);
	await expect(
		drawer.getByRole("list", { name: `${labels.spendingPace} legend` }),
	).not.toContainText(labels.spendingLimit);
	const charges = drawer.getByRole("table", {
		name: new RegExp(labels.cycleSpending),
	});
	await expect(charges).toContainText("Cycle charge A");
	await expect(charges).toContainText("Cycle charge B");
	await expect(charges).toContainText("Cycle charge C");
	const y = async (locator: Locator) => (await locator.boundingBox())?.y ?? 0;
	const chargeA = charges.getByText("Cycle charge A");
	const chargeB = charges.getByText("Cycle charge B");
	const chargeC = charges.getByText("Cycle charge C");
	const chargeBRow = charges.getByRole("row", { name: /Cycle charge B/ });
	await expect(chargeBRow).toContainText(labels.spendingLimit);
	await expect(chargeBRow).toHaveClass(/border-danger-text/);
	await expect(chargeBRow).not.toHaveClass(/border-line/);
	expect(await y(chargeC)).toBeLessThan(await y(chargeB));
	expect(await y(chargeB)).toBeLessThan(await y(chargeA));
	await drawer
		.getByRole("button", { name: /Sort transactions:/ })
		.last()
		.click();
	await expect(charges.getByText("Cycle charge A")).toBeVisible();
	const chargeARow = charges.getByRole("row", { name: /Cycle charge A/ });
	await expect(chargeARow).toContainText(labels.spendingLimit);
	await expect(chargeARow).toHaveClass(/border-danger-text/);
	await expect(chargeARow).not.toHaveClass(/border-line/);
	expect(await y(chargeA)).toBeLessThan(await y(chargeB));
	expect(await y(chargeB)).toBeLessThan(await y(chargeC));
});

test("highlights recurring bills that cannot be fulfilled", async ({
	page,
	request,
}) => {
	await page.clock.setFixedTime(new Date("2026-02-10T12:00:00Z"));
	const modelResponse = await request.get(`${FIXTURE_API}/v1/financial-model`);
	const { model } = await modelResponse.json();
	const contribution = model.schedules.find(
		(rule: { id: string }) => rule.id === "savings_contribution",
	);
	const contributionResponse = await request.post(
		`${FIXTURE_API}/v1/schedules/savings_contribution/amend`,
		{
			data: {
				amount: {
					...contribution.amount,
					config: { ...contribution.amount.config, expression: "10000" },
				},
			},
		},
	);
	expect((await contributionResponse.json()).saved).toBe(true);
	await request.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			statementDay: 20,
			reserve: 725,
			accountIds: null,
			spendingAccountIds: null,
			incomeAccountIds: null,
			incomeScheduleIds: ["salary"],
			transactionIds: null,
			statementDaySet: false,
		},
	});
	await page.goto("/#outlook/safe-spending-detail/cycle");
	const drawer = page.getByRole("dialog", { name: "Safe card spending" });
	const bills = drawer.getByRole("table", {
		name: new RegExp(labels.scheduledBills),
	});
	await expect(bills).toContainText("Retirement contribution");
	await expect(bills).toContainText("Unfulfilled");
	await expect(bills).toContainText("$10,000.00 planned");
	const row = bills.getByRole("row", { name: /Retirement contribution/ });
	await expect(row).toHaveClass(/bg-warning-bg/);
	await expect(row).toHaveClass(/border-warning-text/);
});

for (const theme of ["light", "dark"] as const) {
	test(`household budget fits a narrow ${theme} drawer and passes accessibility checks`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto("/#outlook/safe-spending-detail/last-cycle");
		const budget = page.getByRole("region", { name: labels.cashAfterBills });
		await expect(budget).toBeVisible();
		const overflowing = await budget.evaluate((root) =>
			[root, ...Array.from(root.querySelectorAll("*"))]
				.filter((element) => element.scrollWidth > element.clientWidth + 1)
				.map((element) => element.className),
		);
		expect(overflowing).toEqual([]);
		const accessibility = await new AxeBuilder({ page })
			.include(`[aria-label="${labels.cashAfterBills}"]`)
			.analyze();
		expect(accessibility.violations).toEqual([]);
		await page.getByRole("tab", { name: /Last cycle/ }).click();
		await expect(
			page.getByRole("dialog", { name: "Safe card spending", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("tab", { name: /This cycle/ }),
		).toBeInViewport();
		await expect(
			page.getByRole("tab", { name: "Configure", exact: true }),
		).toBeInViewport();
		const cycleAccessibility = await new AxeBuilder({ page })
			.include("dialog")
			.analyze();
		expect(cycleAccessibility.violations).toEqual([]);
		await page.getByRole("tab", { name: /This cycle/ }).click();
		const currentAccessibility = await new AxeBuilder({ page })
			.include("dialog")
			.analyze();
		expect(currentAccessibility.violations).toEqual([]);
		await page.getByRole("tab", { name: "Configure", exact: true }).click();
		const configureAccessibility = await new AxeBuilder({ page })
			.include("dialog")
			.analyze();
		expect(configureAccessibility.violations).toEqual([]);
	});
}
