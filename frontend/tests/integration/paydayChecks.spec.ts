import { expect, request, test, type Page } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const headline = {
	cycleReset: "2026-11-20",
	cycleStart: "2026-10-20",
	cycleEnd: "2026-11-19",
	daysUntilReset: 3,
	safeToSpend: 300.92,
	incomeFunded: 595.52,
	savingsAllowance: 95.52,
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
		const body = await response.json();
		await route.fulfill({
			status: response.status(),
			headers: response.headers(),
			json: { ...body, ...headline, ...patch },
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

function countSettingsPuts(page: Page) {
	let count = 0;
	page.on("request", (request) => {
		if (
			new URL(request.url()).pathname === "/v1/safe-spending-settings" &&
			request.method() === "PUT"
		)
			count += 1;
	});
	return () => count;
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
	await expect(
		card.getByRole("img", {
			name: "Payment progress: Already paid $175.00. Still to pay $4,054.65.",
		}),
	).toBeVisible();
	await expect(card.getByTestId("unpaid-by-payday")).toHaveText(
		"Still to pay · $4,054.65",
	);
	await expect(
		card.getByRole("img", {
			name: "Next cycle funding: From income $3,486.08. Cash carried forward $896.44.",
		}),
	).toBeVisible();
	await expect(
		card.getByText("Short by $20.00 before a scheduled payment"),
	).toBeVisible();
	await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
		"$4,382.52",
	);
	await expect(card.getByTestId("next-cycle-carryover")).toHaveText(
		"Cash carried forward · $896.44",
	);
	await expect(card.getByTestId("cash-on-hand")).toHaveCount(0);

	const paymentDetails = card
		.locator("summary")
		.filter({ hasText: "Payment details" });
	await expect(card.getByText("Synthetic rent")).toHaveCount(0);
	await expect(card.getByText("Synthetic card")).toHaveCount(0);
	await paymentDetails.focus();
	await page.keyboard.press("Enter");
	await expect(card.getByText("No bill details")).toBeVisible();
	await expect(card.getByText("Synthetic rent")).toHaveCount(0);
	await expect(card.getByText("Synthetic card")).toHaveCount(0);
	expect(await card.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
		await card.evaluate((node) => node.clientWidth),
	);
	await card
		.getByRole("button", {
			name: /^(?:Transactions this cycle|\d+ transactions? this cycle)$/,
		})
		.click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	await expect(drawer.getByText("Oct 20, 2026 – Nov 19, 2026")).toBeVisible();
	const heading = drawer.getByRole("heading", { name: "Spending this cycle" });
	const sort = drawer.getByRole("button", {
		name: /^Sort transactions:/,
	});
	const headingBox = await heading.boundingBox();
	const sortBox = await sort.boundingBox();
	expect(headingBox).not.toBeNull();
	expect(sortBox).not.toBeNull();
	expect(sortBox!.x).toBeGreaterThan(headingBox!.x);
	expect(headingBox!.y).toBeLessThan(sortBox!.y + sortBox!.height);
	expect(sortBox!.y).toBeLessThan(headingBox!.y + headingBox!.height);
	expect(sortBox!.x + sortBox!.width).toBeLessThanOrEqual(360);
	expect(await drawer.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
		await drawer.evaluate((node) => node.clientWidth),
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
	await expect(
		card.getByRole("img", { name: /^Payment progress: / }),
	).toBeVisible();
	await expect(
		card.getByRole("heading", { name: "Bills and payments by Nov 30" }),
	).toBeVisible();
	await card.getByRole("button", { name: "0 transactions this cycle" }).click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	await expect(drawer.getByText("Oct 20, 2026 – Nov 19, 2026")).toBeVisible();
	await expect(
		drawer.getByRole("heading", { name: "Spending this cycle" }),
	).toBeVisible();
	await expect(drawer.getByText("No spending this cycle yet.")).toBeVisible();
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
	await expect(card.getByTestId("paid-by-payday")).toHaveText("$175.00");
	await expect(card.getByTestId("unpaid-by-payday")).toHaveText("Unavailable");
	await expect(
		card.getByRole("img", { name: /^Payment progress: / }),
	).toHaveCount(0);
	await expect(
		card.getByRole("img", { name: /^Next cycle funding: / }),
	).toHaveCount(0);
	await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
		"Over by $80.00",
	);
});

test("monthly budget uses header Save, native validation, and one complete request", async ({
	page,
}) => {
	await overrideSummary(page);
	await page.goto("/outlook");
	const putCount = countSettingsPuts(page);
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(card.getByTestId("with-cash-cushion")).toBeVisible();
	await card.getByRole("button", { name: "Configure" }).click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	const start = drawer.getByLabel("Cycle start day");
	const payday = drawer.getByLabel("Payday of month");
	const target = drawer.getByLabel("Monthly savings goal ($)");
	const save = drawer.getByRole("button", { name: "Save", exact: true });
	await expect(save).toBeDisabled();
	await expect(drawer.getByText("Monthly budget", { exact: true })).toHaveCount(
		0,
	);
	await expect(
		drawer.getByText("Days 1–31 · Short months: last day"),
	).toHaveCount(0);
	await expect(
		drawer.getByRole("button", { name: "Save monthly budget" }),
	).toHaveCount(0);

	await start.fill("32");
	await expect(save).toBeEnabled();
	await save.click();
	await expect(start).toBeFocused();
	expect(
		await start.evaluate(
			(input: HTMLInputElement) => input.validity.rangeOverflow,
		),
	).toBe(true);
	expect(putCount()).toBe(0);

	await start.fill("20");
	await expect(save).toBeDisabled();
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(0);
	await start.fill("32");
	await save.click();
	await expect(start).toBeFocused();
	expect(putCount()).toBe(0);

	await start.fill("21");
	await payday.fill("29");
	await target.fill("500");
	await expect(target).toHaveAttribute("aria-describedby", /unsaved/);
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
	expect(putCount()).toBe(1);
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(0);
	await expect(save).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(card.getByTestId("cycle-budget-graph")).toBeVisible();
	await expect(card.getByTestId("savings-target")).toHaveText(
		"Monthly savings goal (set aside) · $500.00",
	);
	await expect(card.getByText("After savings goal ($500.00 goal)")).toHaveCount(
		0,
	);
});

test("mixed configuration changes persist across tabs and save once", async ({
	page,
}) => {
	await overrideSummary(page);
	const putCount = countSettingsPuts(page);
	await page.goto("/outlook?detail=safe-spending&tab=configure");
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	const target = drawer.getByLabel("Monthly savings goal ($)");
	const portfolio = drawer.getByRole("button", {
		name: /Investment portfolio/,
	});
	const save = drawer.getByRole("button", { name: "Save", exact: true });
	await expect(target).toHaveValue("0");
	await expect(portfolio).toHaveAttribute("aria-pressed", "false");
	await expect(save).toBeDisabled();

	await target.fill("450");
	await portfolio.click();
	await expect(portfolio).toHaveAttribute("aria-pressed", "true");
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(2);
	await expect(save).toBeEnabled();
	expect(putCount()).toBe(0);

	await portfolio.click();
	await expect(portfolio).toHaveAttribute("aria-pressed", "false");
	await expect(portfolio.getByText("Unsaved", { exact: true })).toHaveCount(0);
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(1);
	await expect(save).toBeEnabled();
	await portfolio.click();

	await drawer.getByRole("tab", { name: /Transactions/ }).click();
	await expect(
		drawer.getByRole("button", { name: "Save", exact: true }),
	).toHaveCount(0);
	await drawer.getByRole("tab", { name: /Configure/ }).click();
	await expect(target).toHaveValue("450");
	await expect(portfolio).toHaveAttribute("aria-pressed", "true");
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(2);
	expect(putCount()).toBe(0);

	await page.keyboard.press("Escape");
	const confirm = page.getByRole("alertdialog", {
		name: "Discard changes?",
	});
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Continue editing" }).click();
	await expect(drawer).toBeVisible();
	await expect(target).toHaveValue("450");

	const saved = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
			response.request().method() === "PUT",
	);
	await save.click();
	const response = await saved;
	expect(response.ok()).toBe(true);
	const body = response.request().postDataJSON();
	expect(body).toMatchObject({ savingsTarget: 450 });
	expect(body.spendingAccountIds).toHaveLength(2);
	expect(putCount()).toBe(1);
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(0);
	await expect(save).toBeDisabled();
});

test("URL-restored Configure waits for saved settings before enabling edits", async ({
	page,
}) => {
	await overrideSummary(page);
	const api = await request.newContext();
	try {
		const response = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
			data: {
				cycleStartDay: 7,
				paydayDay: 15,
				savingsTarget: 250,
				accountIds: null,
				spendingAccountIds: ["checking"],
				incomeScheduleIds: [],
				transactionIds: null,
			},
		});
		expect(response.ok(), await response.text()).toBe(true);
	} finally {
		await api.dispose();
	}

	let releaseSettings!: () => void;
	const settingsReady = new Promise<void>((resolve) => {
		releaseSettings = resolve;
	});
	await page.route("**/v1/safe-spending-settings", async (route) => {
		if (route.request().method() !== "GET") {
			await route.continue();
			return;
		}
		const response = await route.fetch();
		await settingsReady;
		await route.fulfill({ response });
	});

	try {
		const putCount = countSettingsPuts(page);
		await page.goto("/outlook?detail=safe-spending&tab=configure");
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		const start = drawer.getByLabel("Cycle start day");
		const payday = drawer.getByLabel("Payday of month");
		const target = drawer.getByLabel("Monthly savings goal ($)");
		const checking = drawer.getByRole("button", { name: /Everyday checking/ });
		const save = drawer.getByRole("button", { name: "Save", exact: true });
		await expect(start).toBeDisabled();
		await expect(payday).toBeDisabled();
		await expect(target).toBeDisabled();
		await expect(checking).toBeDisabled();
		await expect(save).toBeDisabled();
		expect(putCount()).toBe(0);

		releaseSettings();
		await expect(start).toHaveValue("7");
		await expect(payday).toHaveValue("15");
		await expect(target).toHaveValue("250");
		await expect(checking).toHaveAttribute("aria-pressed", "true");
		await expect(target).toBeEnabled();
		await expect(save).toBeDisabled();

		await target.fill("300");
		await expect(save).toBeEnabled();
		const saved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
				response.request().method() === "PUT",
		);
		await save.click();
		const response = await saved;
		expect(response.ok()).toBe(true);
		expect(response.request().postDataJSON()).toMatchObject({
			cycleStartDay: 7,
			paydayDay: 15,
			savingsTarget: 300,
			spendingAccountIds: ["checking"],
		});
		expect(putCount()).toBe(1);
	} finally {
		releaseSettings();
	}
});

test("failed save and recovery keep the modal draft mounted for retry", async ({
	page,
}) => {
	await overrideSummary(page);
	await page.goto("/outlook?detail=safe-spending&tab=configure");
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	const target = drawer.getByLabel("Monthly savings goal ($)");
	const save = drawer.getByRole("button", { name: "Save", exact: true });
	await expect(target).toHaveValue("0");

	let failPut = true;
	let failGet = true;
	await page.route("**/v1/safe-spending-settings", async (route) => {
		if (route.request().method() === "PUT" && failPut) {
			failPut = false;
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					title: "Your changes could not be saved. Try again.",
				}),
			});
			return;
		}
		if (route.request().method() === "GET" && failGet) {
			failGet = false;
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					title: "Your saved settings could not be reloaded. Try again.",
				}),
			});
			return;
		}
		await route.continue();
	});

	await target.fill("321");
	await expect(save).toBeEnabled();
	const failed = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
			response.request().method() === "PUT",
	);
	await save.click();
	expect((await failed).status()).toBe(500);

	await expect(drawer).toBeVisible();
	await expect(target).toHaveValue("321");
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(1);
	await expect(
		drawer.getByText(
			"Changes were not saved. Review the values and try again.",
		),
	).toBeVisible();
	await expect(save).toBeEnabled();
	await expect(
		drawer.getByText("Budget settings could not be loaded."),
	).toHaveCount(0);

	const retried = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
			response.request().method() === "PUT",
	);
	await save.click();
	const response = await retried;
	expect(response.ok()).toBe(true);
	expect(response.request().postDataJSON()).toMatchObject({
		savingsTarget: 321,
	});
	await expect(drawer.getByText("Unsaved", { exact: true })).toHaveCount(0);
	await expect(save).toBeDisabled();
});

test("pending save status stays visible after switching tabs", async ({
	page,
}) => {
	await overrideSummary(page);
	await page.goto("/outlook?detail=safe-spending&tab=configure");
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	const target = drawer.getByLabel("Monthly savings goal ($)");
	const save = drawer.getByRole("button", { name: "Save", exact: true });
	const close = drawer.getByRole("button", { name: "Close", exact: true });
	await target.fill("222");

	let releasePut!: () => void;
	const putReady = new Promise<void>((resolve) => {
		releasePut = resolve;
	});
	await page.route("**/v1/safe-spending-settings", async (route) => {
		if (route.request().method() !== "PUT") {
			await route.continue();
			return;
		}
		await putReady;
		await route.continue();
	});

	try {
		const saved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
				response.request().method() === "PUT",
		);
		await save.click();
		await expect(drawer.getByText("Saving changes…")).toBeVisible();
		await expect(close).toBeDisabled();

		await drawer.getByRole("tab", { name: /Transactions/ }).click();
		await expect(drawer.getByText("Saving changes…")).toBeVisible();
		await expect(close).toBeDisabled();
		await expect(
			drawer.getByRole("button", { name: "Save", exact: true }),
		).toHaveCount(0);

		releasePut();
		expect((await saved).ok()).toBe(true);
		await expect(drawer.getByText("Saving changes…")).toHaveCount(0);
		await expect(close).toBeEnabled();
	} finally {
		releasePut();
	}
});
