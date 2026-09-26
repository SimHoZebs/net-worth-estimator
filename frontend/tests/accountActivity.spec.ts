import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function openChecking(page: Page) {
	await page.goto("/");
	await page
		.locator(".accounts-grid")
		.getByRole("button", { name: /Everyday checking/ })
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
	await expect(
		dialog.getByRole("button", { name: /Inspect Household payroll/ }),
	).toHaveCount(3);
	await expect(
		dialog.getByRole("button", {
			name: "Inspect Household take-home pay on Sep 28, 2026",
		}),
	).toBeVisible();
	await dialog.getByLabel("Transaction source").selectOption("recorded");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–3 of 3 transactions",
	);
	await expect(dialog.getByText("Projected", { exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Oldest first" }).click();
	await expect(dialog.locator("tbody tr").first()).toContainText(
		"Aug 28, 2026",
	);
	await dialog
		.getByRole("button", { name: "Inspect Household payroll on Aug 28, 2026" })
		.click();
	await expect(dialog.locator(".transaction-details")).toContainText(
		"Recorded amount",
	);
	await expect(
		dialog.getByRole("button", { name: "Edit recorded movement" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(
		page
			.locator(".accounts-grid")
			.getByRole("button", { name: /Everyday checking/ }),
	).toBeFocused();
});

test("account names in the plan open incoming transfers with the correct other account", async ({
	page,
}) => {
	await page.goto("/#plan");
	await page
		.getByRole("button", { name: "Open Investment portfolio transactions" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Investment portfolio" });
	await dialog.getByLabel("Transaction dates").selectOption("30-days");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	await expect(dialog.getByText("+$1,800.00", { exact: true })).toBeVisible();
	await dialog
		.getByRole("button", { name: "Inspect Monthly investing on Oct 3, 2026" })
		.click();
	await expect(dialog.locator(".transaction-details")).toContainText(
		"Everyday checking",
	);
	await expect(dialog.locator(".transaction-details")).toContainText(
		"Investment portfolio",
	);
	await dialog.getByLabel("Transaction direction").selectOption("out");
	await expect(
		dialog.getByRole("heading", { name: "No matching transactions" }),
	).toBeVisible();
	await dialog
		.getByRole("button", { name: "Clear transaction filters" })
		.click();
	await expect(
		dialog.getByRole("button", { name: "Next transaction page" }),
	).toBeEnabled();
});

test("a shortfall can be inspected and edited while preserving account context and the saved plan", async ({
	page,
}) => {
	let dialog = await openChecking(page);
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("renovation");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	await expect(dialog.getByText("Shortfall", { exact: true })).toBeVisible();
	await dialog
		.getByRole("button", { name: "Inspect Home renovation on Jun 15, 2028" })
		.click();
	await expect(dialog.locator(".transaction-details")).toContainText(
		"Protected account balance",
	);
	await expect(dialog.locator(".transaction-details")).toContainText("$48,000");
	await dialog.getByRole("button", { name: "Edit planned movement" }).click();
	await expect(
		page.getByRole("dialog", { name: "Edit planned movement" }),
	).toBeVisible();
	await page.getByLabel("Amount (USD)").fill("30000");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	dialog = page.getByRole("dialog", { name: "Everyday checking" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Account activity · Temporary version");
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("renovation");
	await expect(dialog.getByText("−$30,000.00", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Shortfall", { exact: true })).toHaveCount(0);
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("waypoint.workspace.v1")!),
	);
	expect(
		stored.saved.movements.find(
			(movement: { id: string }) => movement.id === "renovation",
		).amount,
	).toBe(48000);
	expect(
		stored.draft.movements.find(
			(movement: { id: string }) => movement.id === "renovation",
		).amount,
	).toBe(30000);
});

test("filters reset pagination and keep projected transfers distinct from recorded income", async ({
	page,
}) => {
	const dialog = await openChecking(page);
	await dialog.getByRole("button", { name: "Next transaction page" }).click();
	await expect(dialog.getByRole("status")).toContainText("Showing 11–20");
	await dialog.getByLabel("Transaction dates").selectOption("30-days");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–5 of 5 transactions",
	);
	await dialog.getByLabel("Transaction direction").selectOption("transfer");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–3 of 3 transactions",
	);
	await expect(
		dialog.getByRole("button", { name: /Inspect Household payroll/ }),
	).toHaveCount(0);
	await dialog
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("retirement savings");
	await expect(dialog.getByRole("status")).toHaveText(
		"Showing 1–1 of 1 transactions",
	);
	await expect(
		dialog.getByRole("button", { name: /Inspect Retirement contribution/ }),
	).toBeVisible();
	await expect(dialog.getByText("−$1,100.00", { exact: true })).toBeVisible();
});

test("growth-only accounts have an honest empty state and retain account details", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.locator(".accounts-grid")
		.getByRole("button", { name: /Home value/ })
		.click();
	const dialog = page.getByRole("dialog", { name: "Home value" });
	await expect(
		dialog.getByRole("heading", {
			name: "No transactions for this account yet",
		}),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Add a planned movement" }),
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
	await expect(dialog).toContainText("Annual rate assumption");
	await expect(dialog).toContainText("Example home estimate");
	await dialog
		.getByRole("button", { name: "Edit account", exact: true })
		.click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Home value" })).toBeVisible();
});

test("account transactions and expanded evidence are accessible on desktop and mobile", async ({
	page,
}) => {
	for (const width of [1440, 390, 320]) {
		await page.setViewportSize({ width, height: 960 });
		const dialog = await openChecking(page);
		await dialog
			.getByRole("searchbox", { name: "Search account transactions" })
			.fill("renovation");
		await dialog
			.getByRole("button", { name: "Inspect Home renovation on Jun 15, 2028" })
			.click();
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
			await dialog.evaluate(
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
	}
});
