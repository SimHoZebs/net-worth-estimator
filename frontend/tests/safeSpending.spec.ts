import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FIXTURE_API, resetFixture, seedResourceStorage } from "./fixture.ts";
import { SAFE_SPENDING_LABELS as labels } from "../src/pages/outlook/safe-spending/safeSpendingLabels.ts";
import { SAFE_SPENDING_STORAGE_KEY } from "../src/state/persisted.ts";

test.beforeEach(async ({ page, request }) => {
	await resetFixture();
	await page.clock.setFixedTime(new Date("2026-01-31T12:00:00Z"));
	// Make salary current, rather than a future-start rule, without changing
	// any projected amounts after the January balance checkpoint.
	const model = await request.get(`${FIXTURE_API}/v1/financial-model`);
	const { document } = await model.json();
	const salary = document.recurrenceRules.find(
		(rule: { id: string }) => rule.id === "salary",
	);
	const response = await request.patch(
		`${FIXTURE_API}/v1/recurrence-rules/salary`,
		{
			data: { ...salary, startDate: "2026-01-01" },
		},
	);
	expect((await response.json()).persisted).toBe(true);
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
	} finally {
		await fresh.close();
	}
});

test("household budget shows paycheck allocation and one sortable cycle bill list", async ({
	page,
	request,
}) => {
	const checkpoint = await request.post(`${FIXTURE_API}/v1/checkpoints`, {
		data: { AccountId: "loan", Date: "2026-01-19", Balance: -4321 },
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
	await expect(
		drawer.getByRole("region", { name: labels.paycheckAllocation }),
	).toHaveCount(0);
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	const budget = drawer.getByRole("region", {
		name: labels.paycheckAllocation,
	});
	await expect(budget).toBeVisible();
	await expect(budget.getByRole("heading")).toHaveCount(0);
	await expect(budget).toHaveCSS("padding", "0px");
	await expect(budget).toHaveCSS("border-top-width", "0px");
	await expect(budget).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(budget).toContainText("Next paycheck · Feb 1");
	await expect(
		drawer.getByText("Dec 20, 2025 – Jan 19, 2026", { exact: true }),
	).toHaveCount(1);
	await expect(
		budget.getByRole("list", { name: "Closed card balances" }),
	).toContainText("$4,321.00");
	await expect(budget).toContainText("Saved balances at close");
	await expect(budget).not.toContainText("New · Jan 20 – Feb 19");
	await expect(
		budget.getByText(labels.unallocated, { exact: true }),
	).toBeVisible();
	await expect(drawer.getByText(labels.allowance, { exact: true })).toHaveCount(
		0,
	);
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(
		drawer.getByText("Jan 20, 2026 – Feb 19, 2026", { exact: true }),
	).toHaveCount(1);
	await expect(drawer.getByRole("list", { name: / details$/ })).toHaveCount(0);
	await expect(budget).toHaveCount(0);
	await expect(
		drawer.getByRole("list", { name: "Closed card balances" }),
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
		data: { AccountId: "loan", Date: "2026-01-19", Balance: -4321 },
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
		const time = new Date(`${day}T12:00:00Z`).getTime() / 1000;
		const response = await request.post(`${FIXTURE_API}/v1/postings`, {
			data: {
				id,
				name,
				sourceAccountId: "loan",
				destinations: null,
				amount: {
					resolver: "expression",
					config: { expression: String(amount) },
					inputs: {},
				},
				postedTime: time,
				transactionTime: time,
				enabled: true,
			},
		});
		expect(response.ok()).toBe(true);
		expect((await response.json()).persisted).toBe(true);
	}
	await page.goto("/#outlook/safe-spending-detail/mandatory");
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(page).toHaveURL(/safe-spending-detail\/last-cycle$/);
	const last = page.getByRole("dialog", {
		name: "Safe card spending",
		exact: true,
	});
	await expect(
		last.getByRole("list", { name: "Closed card balances" }),
	).toContainText("$4,321.00");
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
		page.getByRole("list", { name: "Closed card balances" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("region", { name: labels.paycheckAllocation }),
	).toHaveCount(0);
	await expect(
		page.getByRole("dialog").getByText(labels.allowance, { exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(/safe-spending-detail\/cycle$/);
	const currentCharges = page.getByRole("table", {
		name: new RegExp(labels.recordedCharges),
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
		.include('[role="dialog"]')
		.analyze();
	expect(accessibility.violations).toEqual([]);
});

test("Configure only selects sources and settings, and ignores legacy overrides", async ({
	page,
	request,
}) => {
	const response = await request.post(`${FIXTURE_API}/v1/checkpoints`, {
		data: { AccountId: "loan", Date: "2026-01-19", Balance: -4321 },
	});
	expect(response.ok()).toBe(true);
	await seedResourceStorage(
		page,
		SAFE_SPENDING_STORAGE_KEY,
		JSON.stringify({
			state: {
				statementDay: 20,
				statementDaySet: true,
				reserve: 725,
				incomeRuleIds: ["salary"],
				checkingOverride: 10000,
				remainingOverride: 20000,
				paycheckOverride: 30000,
				fixedOverride: 40000,
				spentOverride: 50000,
			},
			version: 4,
		}),
	);
	const writes: string[] = [];
	page.on("request", (request) => {
		if (
			request.url().includes("/v1/") &&
			request.method() !== "GET" &&
			!request.url().includes("/projections/") &&
			!request.url().endsWith("/v1/position")
		)
			writes.push(`${request.method()} ${request.url()}`);
	});
	await page.goto("/#outlook/safe-spending-detail");
	const metric = (label: string) =>
		page
			.getByRole("dialog")
			.getByRole("region", { name: label, exact: true })
			.getByTestId("metric-value");
	await expect(metric(labels.cashAfterBills)).toHaveText("$4,200");
	await expect(metric(labels.allowance)).toHaveText("-$375");
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	await expect(page.getByRole("spinbutton")).toHaveCount(2);
	await expect(page.getByLabel("Calculated budget values")).toHaveCount(0);
	for (const label of [
		labels.cashBalance,
		labels.remainingBills,
		labels.nextPaycheck,
		labels.fixedBills,
		labels.cardSpending,
	]) {
		await expect(
			page.getByRole("status", { name: label, exact: true }),
		).toHaveCount(0);
		await expect(page.getByLabel(`${label} ($)`, { exact: true })).toHaveCount(
			0,
		);
	}
	await page
		.getByRole("group", { name: labels.cashAccounts })
		.getByRole("button", { name: "Investment portfolio" })
		.click();
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(metric(labels.cashAfterBills)).toHaveText("$19,200");
	await expect(metric(labels.allowance)).toHaveText("-$375");
	await expect(
		page
			.getByRole("table", { name: new RegExp(labels.scheduledBills) })
			.locator("tbody tr"),
	).toHaveCount(3);
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	await page
		.getByRole("group", { name: "Included bills" })
		.getByRole("button", { name: /^Housing and living/ })
		.click();
	const reserveSaved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/v1/safe-spending-settings") &&
			response.request().method() === "PUT" &&
			response.request().postDataJSON().reserve === 100,
	);
	await page.getByLabel(`${labels.reserve} ($)`, { exact: true }).fill("100");
	expect((await reserveSaved).ok()).toBe(true);
	await page.reload();
	await expect(
		page.getByRole("button", { name: /^Housing and living/ }),
	).toHaveAttribute("aria-pressed", "false");
	await expect(
		page
			.getByRole("group", { name: labels.cashAccounts })
			.getByRole("button", { name: "Investment portfolio" }),
	).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(metric(labels.cashAfterBills)).toHaveText("$19,200");
	await expect(metric(labels.allowance)).toHaveText("$4,050");
	await expect(
		page.getByText("No recorded card charges in this cycle yet.", {
			exact: true,
		}),
	).toBeVisible();
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	const unallocated = page
		.getByRole("dialog")
		.getByText(labels.unallocated, { exact: true })
		.locator("..")
		.locator("dd");
	await expect(unallocated).toHaveText("-$271.00");
	await expect(
		page.getByRole("list", { name: labels.closedCardBalances }),
	).toContainText("$4,321.00");
	expect(writes.length).toBeGreaterThan(0);
	expect(
		writes.every(
			(write) =>
				write.endsWith("/v1/safe-spending-settings") &&
				write.startsWith("PUT "),
		),
	).toBe(true);
});

test("income sources combine independent recurrence rules and persist explicit deselection", async ({
	page,
	request,
}) => {
	const response = await request.post(`${FIXTURE_API}/v1/recurrence-rules`, {
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
	expect((await response.json()).persisted).toBe(true);
	await page.goto("/#outlook/safe-spending-detail/configure");
	const sources = page.getByRole("group", { name: "Income sources" });
	const salary = sources.getByRole("button", { name: /^Salary/ });
	const partner = sources.getByRole("button", {
		name: /^Partner take-home pay/,
	});
	await expect(salary).toHaveAttribute("aria-pressed", "false");
	await expect(partner).toHaveAttribute("aria-pressed", "false");
	await salary.click();
	await partner.focus();
	const sourcesSaved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/v1/safe-spending-settings") &&
			response.request().method() === "PUT" &&
			response.request().postDataJSON().incomeRuleIds.length === 2,
	);
	await page.keyboard.press("Space");
	expect((await sourcesSaved).ok()).toBe(true);
	await page.reload();
	await expect(salary).toHaveAttribute("aria-pressed", "true");
	await expect(partner).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("tab", { name: /This cycle/ }).click();
	await expect(
		page
			.getByRole("region", { name: labels.allowance, exact: true })
			.getByTestId("metric-value"),
	).toHaveText("$1,025");
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(
		page.getByRole("region", { name: labels.paycheckAllocation }),
	).toContainText("Next paycheck · Feb 1 – Feb 10");
	await expect(
		page
			.getByRole("region", { name: labels.paycheckAllocation })
			.getByText("$7,000.00", { exact: true }),
	).toBeVisible();
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	await salary.click();
	await page.getByRole("tab", { name: /Last cycle/ }).click();
	await expect(
		page
			.getByRole("region", { name: labels.paycheckAllocation })
			.getByText("$1,400.00", { exact: true }),
	).toBeVisible();
	await page.getByRole("tab", { name: "Configure", exact: true }).click();
	const deselectionSaved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/v1/safe-spending-settings") &&
			response.request().method() === "PUT" &&
			response.request().postDataJSON().incomeRuleIds.length === 0,
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
	).toHaveText("-$5,975");
});

for (const theme of ["light", "dark"] as const) {
	test(`household budget fits a narrow ${theme} drawer and passes accessibility checks`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto("/#outlook/safe-spending-detail/last-cycle");
		const budget = page.getByRole("region", {
			name: labels.paycheckAllocation,
		});
		await expect(budget).toBeVisible();
		const overflowing = await budget.evaluate((root) =>
			[root, ...Array.from(root.querySelectorAll("*"))]
				.filter((element) => element.scrollWidth > element.clientWidth + 1)
				.map((element) => element.className),
		);
		expect(overflowing).toEqual([]);
		const accessibility = await new AxeBuilder({ page })
			.include(`[aria-label="${labels.paycheckAllocation}"]`)
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
			.include('[role="dialog"]')
			.analyze();
		expect(cycleAccessibility.violations).toEqual([]);
		await page.getByRole("tab", { name: /This cycle/ }).click();
		await expect(
			page.getByRole("region", { name: labels.paycheckAllocation }),
		).toHaveCount(0);
		const currentAccessibility = await new AxeBuilder({ page })
			.include('[role="dialog"]')
			.analyze();
		expect(currentAccessibility.violations).toEqual([]);
		await page.getByRole("tab", { name: "Configure", exact: true }).click();
		const configureAccessibility = await new AxeBuilder({ page })
			.include('[role="dialog"]')
			.analyze();
		expect(configureAccessibility.violations).toEqual([]);
	});
}
