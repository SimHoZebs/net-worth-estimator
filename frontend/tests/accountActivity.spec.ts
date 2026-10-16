import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
	readSavedServerPlan,
	readTemporaryVersion,
	resetFixture,
} from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function openChecking(page: Page) {
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	return page.getByRole("dialog", { name: "Everyday checking" });
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
		dialog.getByRole("button", { name: /Edit Household payroll/ }),
	).toHaveCount(2);
	await expect(
		dialog.getByRole("button", {
			name: "Edit Household take-home pay on Jan 28, 2026",
		}),
	).toBeVisible();
	await dialog.getByLabel("Transaction source").selectOption("historical");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–3 of 3 transactions",
	);
	// Rows carry no provenance badges; shortfalls and exclusions still do.
	await expect(dialog.locator("tbody .badge")).toHaveCount(0);
	// Historical activity is listed newest first by default, and the control
	// toggles rather than sets.
	await expect(dialog.locator("tbody tr").first()).toContainText(
		"Jan 29, 2026",
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
		"Jan 29, 2026",
	);
	await dialog
		.getByRole("button", { name: "Edit Household payroll on Jan 15, 2026" })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Household payroll" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("dialog", { name: "Everyday checking" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Open Everyday checking transactions" }),
	).toBeFocused();
});

test("account names in the plan open incoming transfers with the correct other account", async ({
	page,
}) => {
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Investment portfolio transactions" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Investment portfolio" });
	// The account dialog defaults to recorded facts; the contribution is a
	// projected occurrence, so include all transactions first.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog.getByLabel("Transaction dates").selectOption("30-days");
	// One monthly contribution lands inside the first 30 days.
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	// The only incoming movement to savings is the monthly contribution.
	await expect(dialog.getByText("+$400.00", { exact: true })).toBeVisible();
	await dialog
		.getByRole("button", {
			name: "Edit Retirement contribution on Feb 12, 2026",
		})
		.click();
	await expect(
		page.getByRole("dialog", { name: "Retirement contribution" }),
	).toBeVisible();
	await expect(page.getByLabel("From", { exact: true })).toContainText(
		"Everyday checking",
	);
	await expect(page.getByLabel("To", { exact: true })).toContainText(
		"Investment portfolio",
	);
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Investment portfolio" }),
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

test("a shortfall can be inspected and edited while preserving account context and the saved plan", async ({
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
		.getByRole("button", { name: "Edit Home renovation on Mar 6, 2026" })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Home renovation" }),
	).toBeVisible();
	await page.getByLabel("Amount (USD)").fill("3000");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	dialog = page.getByRole("dialog", { name: "Everyday checking" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Account activity · Changes");
	// Returning from the editor remounts the list with default filters.
	await dialog.getByLabel("Transaction source").selectOption("all");
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("renovation");
	await expect(dialog.getByText("−$3,000.00", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Shortfall", { exact: true })).toHaveCount(0);
	// The saved plan is untouched: only the unsaved changes changed.
	const draft = await readTemporaryVersion(page);
	const renovation = (plan: { movements: { id: string; amount: number }[] }) =>
		plan.movements.find((movement) => movement.id === "renovation")?.amount;
	expect(renovation(draft)).toBe(3000);
	const saved = await readSavedServerPlan();
	const savedExpression = saved.postings.find(
		(posting) => posting.id === "renovation",
	)?.amount.config.expression;
	expect(savedExpression).toBe("9000");
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
		dialog.getByRole("button", { name: /Edit Household payroll/ }),
	).toHaveCount(0);
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("retirement contribution");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	await expect(
		dialog.getByRole("button", { name: /Edit Retirement contribution/ }),
	).toBeVisible();
	await expect(dialog.getByText("−$400.00", { exact: true })).toBeVisible();
});

test("clicking outside the account panel closes it", async ({ page }) => {
	const dialog = await openChecking(page);
	await expect(dialog).toBeVisible();
	// The drawer occupies the right side, so the far left is backdrop film.
	await page.mouse.click(10, 300);
	await expect(dialog).not.toBeVisible();
});

test("growth-only accounts have an honest empty state and retain account details", async ({
	page,
}) => {
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Home value transactions" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Home value" });
	await expect(
		dialog.getByRole("heading", {
			name: "No transactions for this account yet",
		}),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Add a planned transaction" }),
	).toBeVisible();
	await expect(
		dialog.locator('.account-view-tabs > button[role="tab"]'),
	).toHaveCount(2);
	await expect(
		dialog.getByRole("searchbox", { name: "Search account transactions" }),
	).toHaveCount(0);
	await dialog.getByRole("tab", { name: /Transactions/ }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(
		dialog.getByRole("tab", { name: "Account details" }),
	).toBeFocused();
	await expect(dialog).toContainText("No maxBalance");
	await expect(dialog).toContainText("$340,000");
	await dialog
		.getByRole("button", { name: "Edit account", exact: true })
		.click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Home value" })).toBeVisible();
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
			.getByRole("button", { name: "Edit Home renovation on Mar 6, 2026" })
			.click();
		const editor = page.getByRole("dialog", { name: "Home renovation" });
		await expect(editor).toBeVisible();
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
			await editor.evaluate(
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
			page.getByRole("dialog", { name: "Everyday checking" }),
		).toBeVisible();
		await page.keyboard.press("Escape");
	}
});
