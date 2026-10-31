import { expect, test, type Page } from "@playwright/test";
import { readSavedServerModel, resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

async function openCheckingActivity(page: Page) {
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	return page.getByRole("dialog", { name: "Everyday checking" });
}

test("finance lists, recorded activity, and account details request no forecast", async ({
	page,
}) => {
	const forecasts: string[] = [];
	await page.route("**/v1/projections/*", async (route) => {
		forecasts.push(route.request().url());
		await route.abort();
	});
	await page.goto("/#transactions");
	await expect(
		page.getByRole("button", {
			name: "View Household payroll on Jan 29, 2026",
		}),
	).toBeVisible();
	await page.getByRole("tab", { name: /Recurring/ }).click();
	await expect(
		page.getByRole("button", { name: "View Monthly investing on Monthly" }),
	).toBeVisible();
	await expect(page.getByText("Varies", { exact: true })).toBeVisible();
	const account = await openCheckingActivity(page);
	await expect(
		account.getByRole("button", { name: /View Household payroll/ }),
	).toHaveCount(2);
	await account.getByRole("tab", { name: /Recurring/ }).click();
	await expect(
		account.getByText("Monthly investing", { exact: true }),
	).toBeVisible();
	await account.getByRole("tab", { name: "Account details" }).click();
	await expect(account.getByLabel("Account name")).toHaveValue(
		"Everyday checking",
	);
	expect(forecasts).toEqual([]);
});

test("account and transaction edits survive a failed forecast", async ({
	page,
}) => {
	await page.route("**/v1/projections/*", (route) =>
		route.fulfill({
			status: 500,
			contentType: "application/json",
			headers: {
				"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
			},
			json: { error: "Forecast unavailable for test" },
		}),
	);
	await page.goto("/");
	await expect(
		page.getByText("Could not calculate forecast.", { exact: false }),
	).toBeVisible();
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await page.getByRole("tab", { name: /Recurring/ }).click();
	await page
		.getByRole("button", { name: "View Monthly investing on Monthly" })
		.click();
	await page.getByLabel("Amount (USD)").fill("900");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect
		.poll(async () => {
			const saved = await readSavedServerModel();
			return saved.recurrenceRules.find((rule) => rule.id === "invest")?.amount
				.config.expression;
		})
		.toBe("900");
	await page.keyboard.press("Escape");
	const account = await openCheckingActivity(page);
	await account.getByRole("tab", { name: "Account details" }).click();
	await account.getByLabel("Protected balance in USD").fill("250");
	await account.getByRole("button", { name: "Save changes" }).click();
	await expect
		.poll(async () => {
			const saved = await readSavedServerModel();
			return saved.accounts.find((row) => row.id === "checking")?.minBalance;
		})
		.toBe(250);
	await page.reload();
	await expect(
		page.getByRole("dialog", { name: "Everyday checking" }),
	).toBeVisible();
});

test("projected activity owns its error and retry without blocking recorded history", async ({
	page,
}) => {
	let fail = true;
	let forecasts = 0;
	await page.route("**/v1/projections/deterministic", async (route) => {
		forecasts++;
		if (!fail) return route.continue();
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			headers: {
				"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
			},
			json: { error: "Forecast unavailable for test" },
		});
	});
	const account = await openCheckingActivity(page);
	await expect(
		account.getByRole("button", { name: /View Household payroll/ }),
	).toHaveCount(2);
	expect(forecasts).toBe(0);
	await account.getByLabel("Transaction source").selectOption("projected");
	await expect(
		account.getByRole("button", { name: "Retry forecast" }),
	).toBeVisible();
	await account.getByLabel("Transaction source").selectOption("historical");
	await expect(
		account.getByRole("button", { name: /View Household payroll/ }),
	).toHaveCount(2);
	await expect(
		account.getByRole("button", { name: "Retry forecast" }),
	).toHaveCount(0);
	await account.getByLabel("Transaction source").selectOption("projected");
	await expect(
		account.getByRole("button", { name: "Retry forecast" }),
	).toBeVisible();
	fail = false;
	await account.getByRole("button", { name: "Retry forecast" }).click();
	await account.getByLabel("Transaction dates").selectOption("30-days");
	await expect(
		account.getByRole("button", { name: "View Salary on Feb 1, 2026" }),
	).toBeVisible();
	await expect(
		account.getByRole("button", { name: "Retry forecast" }),
	).toHaveCount(0);
	expect(forecasts).toBeGreaterThan(1);
});

test("an account without recorded transactions can request projected activity", async ({
	page,
}) => {
	let forecasts = 0;
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/v1/projections/deterministic")
			forecasts++;
	});
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Investment portfolio transactions" })
		.click();
	const account = page.getByRole("dialog", { name: "Investment portfolio" });
	await expect(
		account.getByRole("tab", { name: /Transactions/ }),
	).toHaveAttribute("aria-selected", "true");
	expect(forecasts).toBe(0);
	await account.getByLabel("Transaction source").selectOption("projected");
	await account.getByLabel("Transaction dates").selectOption("30-days");
	await expect(
		account.getByRole("button", {
			name: "View Retirement contribution on Feb 12, 2026",
		}),
	).toBeVisible();
	expect(forecasts).toBeGreaterThan(0);
});
