import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./base.ts";
import type { FinancialModel } from "../../src/api/contracts.ts";
import { FIXTURE_API, readSavedServerModel, resetFixture } from "./fixture.ts";
async function openChecking(page: Page) {
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	return page.getByRole("region", { name: "Account details" });
}

test("clicking an account opens its recorded history and projected transactions", async ({
	page,
}) => {
	const dialog = await openChecking(page);
	await expect(
		dialog.getByRole("tab", { name: /Transactions/ }),
	).toHaveAttribute("aria-selected", "true");
	// The fixture records two payroll deposits and one take-home deposit before
	// the projection starts.
	await expect(
		dialog.getByRole("button", { name: /View Household payroll/ }),
	).toHaveCount(2);
	await expect(
		dialog.getByRole("button", {
			name: "View Household take-home pay on Jan 28, 2026",
		}),
	).toBeVisible();
	await dialog.getByLabel("Transaction source").selectOption("historical");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–4 of 4 transactions",
	);
	// Historical activity is listed newest first by default, and the control
	// toggles rather than sets.
	await expect(dialog.locator("tbody tr").first()).toContainText(
		"Jan 31, 2026",
	);
	await dialog.getByRole("button", { name: "Newest first" }).click();
	await expect(
		dialog.getByRole("button", { name: "Oldest first" }),
	).toBeVisible();
	await expect(dialog.locator("tbody tr").first()).toContainText(
		"Jan 15, 2026",
	);
	await dialog.getByRole("button", { name: "Oldest first" }).click();
	await expect(dialog.locator("tbody tr").first()).toContainText(
		"Jan 31, 2026",
	);
	await dialog
		.getByRole("button", { name: "View Household payroll on Jan 15, 2026" })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Household payroll" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("region", { name: "Account details" }),
	).toBeVisible();
	await page
		.getByRole("navigation", { name: "Breadcrumb" })
		.getByRole("button", { name: "Accounts" })
		.click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(
		page.getByRole("button", { name: "Open Everyday checking transactions" }),
	).toBeVisible();
});

test("the transaction actions menu closes on Escape without closing the detail", async ({
	page,
}) => {
	const dialog = await openChecking(page);
	await dialog
		.getByRole("button", { name: "View Household payroll on Jan 15, 2026" })
		.click();
	const detail = page.getByRole("dialog", { name: "Household payroll" });
	await page.getByLabel("Amount (USD)").fill("999");
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeVisible();
	await detail.getByRole("button", { name: "More options" }).click();
	await expect(
		page.getByRole("menu", { name: "Transaction actions" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("menu", { name: "Transaction actions" }),
	).toBeHidden();
	await page.waitForTimeout(600);
	await expect(detail).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Discard the changes in this form?" }),
	).toHaveCount(0);
	await expect(
		detail.getByRole("button", { name: "More options" }),
	).toBeFocused();
});

test("account names in the model open incoming transfers with the correct other account", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Investment portfolio transactions" })
		.click();
	const dialog = page.getByRole("region", { name: "Account details" });
	// The account dialog defaults to recorded facts; the contribution is a
	// projected occurrence, so include all transactions first.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog.getByLabel("Transaction dates").selectOption("30-days");
	// One monthly contribution lands inside the first 30 days.
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	// The only incoming transaction to savings is the monthly contribution.
	await expect(dialog.getByText("+$400.00", { exact: true })).toBeVisible();
	await dialog
		.getByRole("button", {
			name: "View Retirement contribution on Feb 12, 2026",
		})
		.click();
	await expect(
		page.getByRole("dialog", { name: "Retirement contribution" }),
	).toBeVisible();
	await page.getByLabel("Amount (USD)").click();
	await expect(
		page.getByRole("dialog", { name: "Retirement contribution" }),
	).toBeVisible();
	await expect(page.getByLabel("Amount (USD)")).toBeFocused();
	// The route chips are always present and show the right accounts.
	await expect(page.getByLabel("From", { exact: true })).toContainText(
		"Everyday checking",
	);
	await expect(page.getByLabel("To", { exact: true })).toContainText(
		"Investment portfolio",
	);
	await page
		.getByRole("dialog", { name: "Retirement contribution" })
		.getByRole("button", { name: "Close dialog" })
		.click();
	await expect(
		page.getByRole("region", { name: "Account details" }),
	).toBeVisible();
	await dialog.getByLabel("Transaction direction").selectOption("out");
	await expect(
		dialog.getByRole("heading", { name: "No matching transactions" }),
	).toBeVisible();
	await dialog
		.getByRole("button", { name: "Clear transaction filters" })
		.click();
	// Clearing restores the recorded-facts default, which holds no
	// transactions for this account; including everything restores paging.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await expect(
		dialog.getByRole("button", { name: "Next transaction page" }),
	).toBeEnabled();
});

test("transaction values edit in place with save and discard", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Investment portfolio transactions" })
		.click();
	const dialog = page.getByRole("region", { name: "Account details" });
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog.getByLabel("Transaction dates").selectOption("30-days");
	await dialog
		.getByRole("button", {
			name: "View Retirement contribution on Feb 12, 2026",
		})
		.click();
	const detail = page.getByRole("dialog", { name: "Retirement contribution" });
	await expect(detail).toBeVisible();
	// No edit toggle: the values are live controls. Nothing happens until
	// a value actually changes; the first change reveals Save/Discard.
	await page.getByLabel("Amount (USD)").click();
	await expect(page.getByLabel("Amount (USD)")).toBeFocused();
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
		0,
	);
	// Discard restores the read view with the original value.
	await page.getByLabel("Amount (USD)").fill("999");
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Discard changes" }).click();
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
		0,
	);
	await expect(dialog.getByText("+$400.00", { exact: true })).toBeVisible();
	// Changing the source chip summons Save; Discard restores the route.
	await page.getByLabel("From", { exact: true }).focus();
	await expect(page.getByLabel("From", { exact: true })).toBeFocused();
	await page.getByLabel("From", { exact: true }).selectOption("brokerage");
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Discard changes" }).click();
	await expect(page.getByLabel("From", { exact: true })).toContainText(
		"Everyday checking",
	);
	await page.getByLabel("Transaction name").click();
	await expect(page.getByLabel("Transaction name")).toBeFocused();
	// Switching values keeps the open edit: amount becomes the control.
	await page.getByLabel("Amount (USD)").click();
	await expect(page.getByLabel("Amount (USD)")).toBeFocused();
	await page.getByLabel("Amount (USD)").fill("450");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(dialog.getByText("+$450.00", { exact: true })).toBeVisible();
});

test("a shortfall can be inspected and edited while preserving account context and the saved model", async ({
	page,
}) => {
	let dialog = await openChecking(page);
	// The dialog defaults to recorded facts; the renovation is projected.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("renovation");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	await expect(dialog.getByText("Shortfall", { exact: true })).toBeVisible();
	await dialog
		.getByRole("button", { name: "View Home renovation on Mar 6, 2026" })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Home renovation" }),
	).toBeVisible();
	const detail = page.getByRole("dialog", { name: "Home renovation" });
	// Both settlement dates show: transacted in the date button, posted
	// beneath it. Editing uses the dates modal.
	await detail
		.getByRole("button", { name: "Mar 6, 2026", exact: true })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Transaction dates" }),
	).toBeVisible();
	await expect(page.getByLabel("Posted")).toHaveValue("2026-03-08");
	await page.getByLabel("Posted").fill("2026-03-10");
	await page.getByRole("button", { name: "Apply" }).click();
	await page.getByLabel("Amount (USD)").click();
	await page.getByLabel("Amount (USD)").fill("3000");
	await page.getByRole("button", { name: "Save changes" }).click();
	dialog = page.getByRole("region", { name: "Account details" });
	await expect(dialog).toBeVisible();
	await expect(dialog).not.toContainText("Account activity · Saved");
	// Returning from the editor remounts the list with default filters.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("renovation");
	await expect(dialog.getByText("−$3,000.00", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Shortfall", { exact: true })).toHaveCount(0);
	// The editor saves immediately: the dialog shows the edited −$3,000.00
	// with no Shortfall (asserted above) and the saved model carries it too.
	// Find the saved renovation by name.
	await expect(dialog).not.toContainText("Account activity · Saved");
	const saved = await readSavedServerModel();
	const savedExpression = saved.transactions.find(
		(transaction) => transaction.name === "Home renovation",
	)?.amount.config.expression;
	expect(savedExpression).toBe("3000");
});

test("filters reset pagination and keep projected transfers distinct from recorded income", async ({
	page,
}) => {
	const dialog = await openChecking(page);
	// Pagination expectations cover the full activity; the dialog defaults
	// to recorded facts only.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog.getByRole("button", { name: "Next transaction page" }).click();
	await expect(dialog.getByRole("status")).toContainText("Showing 11–20");
	await dialog.getByLabel("Transaction dates").selectOption("30-days");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–6 of 6 transactions",
	);
	await dialog.getByLabel("Transaction direction").selectOption("transfer");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–3 of 3 transactions",
	);
	// Historical income is not a transfer, so the filter must exclude it.
	await expect(
		dialog.getByRole("button", { name: /View Household payroll/ }),
	).toHaveCount(0);
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("retirement contribution");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	await expect(
		dialog.getByRole("button", { name: /View Retirement contribution/ }),
	).toBeVisible();
	await expect(dialog.getByText("−$400.00", { exact: true })).toBeVisible();
});

test("the breadcrumb returns to the accounts list", async ({ page }) => {
	const dialog = await openChecking(page);
	await expect(dialog).toBeVisible();
	await page
		.getByRole("navigation", { name: "Breadcrumb" })
		.getByRole("button", { name: "Accounts" })
		.click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(dialog).not.toBeVisible();
});

test("accounts without transactions show balance history and retain account settings", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Home value transactions" })
		.click();
	const dialog = page.getByRole("region", { name: "Account details" });
	await expect(
		dialog.getByRole("button", { name: /View balance adjustment/ }),
	).toBeVisible();
	await expect(dialog.getByRole("tab")).toHaveCount(3);
	await expect(
		dialog.getByRole("searchbox", { name: "Search account transactions" }),
	).toBeVisible();
	await dialog.getByRole("tab", { name: /Transactions/ }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(dialog.getByRole("tab", { name: "Recurring" })).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(
		dialog.getByRole("tab", { name: "Account details" }),
	).toBeFocused();
	await dialog.getByRole("tab", { name: "Account details" }).click();
	// Name and balance live in the header. Settings contain only settings.
	await expect(dialog.getByLabel("Account name")).toHaveValue("Home value");
	await expect(dialog.getByText("Source")).toHaveCount(0);
	await expect(dialog.getByRole("textbox", { name: "Source" })).toHaveCount(0);
	await expect(dialog.getByLabel("Protected balance in USD")).toHaveValue("0");
	await expect(dialog.getByLabel("Maximum balance in USD")).toHaveCount(0);
	await expect(
		dialog.getByRole("checkbox", { name: "No ceiling" }),
	).toBeChecked();
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	await expect(
		dialog.getByRole("button", { name: "Edit account", exact: true }),
	).toHaveCount(0);
	// Editing saves immediately without opening another dialog.
	await dialog.getByLabel("Protected balance in USD").fill("5000");
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(dialog.getByLabel("Protected balance in USD")).toHaveValue(
		"5000",
	);
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	await expect(dialog).not.toContainText("Account activity · Saved");
	// The inline edit reached the server: the saved model carries the new
	// floor while the dialog shows the same 5000.
	const savedModel = await page.request
		.get(`${FIXTURE_API}/v1/financial-model`)
		.then(async (response) => {
			expect(response.ok()).toBe(true);
			return ((await response.json()) as { model: FinancialModel }).model;
		});
	const home = savedModel.accounts.find((account) => account.id === "home");
	expect(home?.minBalance).toBe(5000);
});

test("a recurring schedule lists transactions that record its occurrences", async ({
	page,
}) => {
	const claim = await page.request.post(
		`${FIXTURE_API}/v1/transactions/c9cc20ed-121a-565b-86a4-b576b5c71e6f/claim`,
		{ data: { scheduleId: "spend", occurrenceDate: "2026-03-05" } },
	);
	expect(claim.ok()).toBe(true);
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const dialog = page.getByRole("region", { name: "Account details" });
	await dialog.getByRole("tab", { name: /Recurring/ }).click();
	await dialog.getByRole("button", { name: /View Housing and living/ }).click();
	const schedule = page.getByRole("dialog", {
		name: /Housing and living/,
	});
	await expect(schedule).toBeVisible();
	const history = schedule.getByRole("region", {
		name: "Recorded transactions",
	});
	// The recorded row shows the day the transaction happened, not the
	// claimed occurrence date (2026-03-05).
	await expect(history).toContainText("Home renovation");
	await expect(history).toContainText("Mar 6, 2026");
	await expect(history).toContainText("−$9,000.00");
	await history
		.getByRole("button", {
			name: /View Home renovation on Mar 6, 2026/,
		})
		.click();
	await expect(
		page.getByRole("dialog", { name: /Home renovation/ }),
	).toBeVisible();
});

test("account transactions and editor evidence are accessible on desktop and mobile", async ({
	page,
}) => {
	for (const width of [1440, 390, 320]) {
		await page.setViewportSize({ width, height: 960 });
		const dialog = await openChecking(page);
		await dialog.getByLabel("Transaction source").selectOption("all");
		await dialog
			.getByRole("searchbox", { name: "Search account transactions" })
			.fill("renovation");
		await dialog
			.getByRole("button", { name: "View Home renovation on Mar 6, 2026" })
			.click();
		const detail = page.getByRole("dialog", { name: "Home renovation" });
		await expect(detail).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze();
		expect(
			results.violations.map((issue) => ({
				rule: issue.id,
				nodes: issue.nodes.map((node) => ({
					target: node.target,
					message: node.failureSummary,
				})),
			})),
			`${width}px`,
		).toEqual([]);
		expect(
			await detail.evaluate(
				(element) => element.scrollWidth <= element.clientWidth,
			),
			`Dialog fits ${width}px`,
		).toBe(true);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
			`Page fits ${width}px`,
		).toBe(true);
		if (width === 1440 || width === 390)
			await page.screenshot({
				path: `test-results/account-transactions-${width === 1440 ? "desktop" : "mobile"}.png`,
			});
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("region", { name: "Account details" }),
		).toBeVisible();
		await page.keyboard.press("Escape");
	}
});

test("an intraday time saves through the detail over the real API", async ({
	page,
}) => {
	const dialog = await openChecking(page);
	await dialog
		.getByRole("button", { name: "View Household payroll on Jan 15, 2026" })
		.click();
	const detail = page.getByRole("dialog", { name: "Household payroll" });
	await expect(detail).toBeVisible();
	// The dates modal edits the occurred day while preserving the stored
	// time of day.
	await detail
		.getByRole("button", { name: "Jan 15, 2026", exact: true })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Transaction dates" }),
	).toBeVisible();
	await page.getByLabel("Occurred").fill("2026-01-15");
	await page.getByRole("button", { name: "Apply" }).click();
	await detail.getByRole("button", { name: "Save changes" }).click();
	await expect(
		dialog.getByRole("button", {
			name: "View Household payroll on Jan 15, 2026",
		}),
	).toBeVisible();
});

test("category is a field row with an icon picker and bank provenance", async ({
	page,
}) => {
	await resetFixture({
		bankTransactions: [
			{
				id: "category-grocer",
				description: "WHOLE FOODS MARKET",
				amount: "-84.20",
				posted: 1769558400,
				extra: { category: "FOOD_AND_DRINK_GROCERIES" },
			},
		],
	});
	const dialog = await openChecking(page);
	await dialog.getByRole("button", { name: /View WHOLE FOODS MARKET/ }).click();
	const detail = page.getByRole("dialog", { name: "WHOLE FOODS MARKET" });
	const bankCategory = detail.getByRole("button", {
		name: "Category Food & drink From your bank",
	});
	await expect(bankCategory).toBeVisible();
	await bankCategory.click();
	const menu = page.getByRole("listbox", { name: "Category" });
	await expect(menu).toBeVisible();
	await menu.getByRole("option", { name: "Medical" }).click();
	const userCategory = detail.getByRole("button", {
		name: "Category Medical Set by you",
	});
	await expect(userCategory).toBeVisible();
	await userCategory.click();
	await detail.getByRole("button", { name: "Use automatic" }).click();
	await expect(bankCategory).toBeVisible();
});
