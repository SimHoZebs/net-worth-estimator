import { expect, test } from "./base.ts";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

for (const name of ["401", "true"]) {
	test(`account ${name} opens through generated and direct deep links`, async ({
		page,
	}) => {
		await page.goto("/accounts?editor=account&id=everyday-checking");
		await page.getByLabel("Account name").fill(name);
		await page
			.getByRole("button", { name: "Save account", exact: true })
			.click();
		await expect(page.getByRole("dialog")).not.toBeVisible();
		await page
			.getByRole("button", { name: `Open ${name} transactions`, exact: true })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/accounts\\?evidence=account&id=${name}$`),
		);
		await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
		await page.goto(`/accounts?evidence=account&id=${name}`);
		await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
	});
}

test("validated search canonicalizes malformed deep links and retains the OAuth outcome", async ({
	page,
}) => {
	await page.goto("/accounts?evidence=account&id=a&id=b&gmail=connected");
	await expect(page).toHaveURL(/\/accounts\?gmail=connected$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await expect(page).toHaveURL(/\/transactions\?gmail=connected$/);
	await page.goto("/accounts?editor=account&id=new&unrelated=value");
	await expect(page).toHaveURL(/\/accounts\?editor=account&id=new$/);
	await expect(
		page.getByRole("dialog", { name: "Add account", exact: true }),
	).toBeVisible();
});

test("root and unknown routes redirect to outlook without adding a history entry", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await page.goto("/not-a-page?gmail=error");
	await expect(page).toHaveURL(/\/outlook\?gmail=error$/);
	await expect(
		page.getByRole("heading", { name: "Your financial outlook" }),
	).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/transactions$/);
	await page.goto("/?gmail=connected");
	await expect(page).toHaveURL(/\/outlook\?gmail=connected$/);
});

test("page navigation moves focus and preserves the native link target", async ({
	page,
}) => {
	await page.goto("/accounts");
	const transactions = page.getByRole("link", {
		name: "Transactions",
		exact: true,
	});
	await expect(transactions).toHaveAttribute("href", "/transactions");
	await transactions.click();
	await expect(
		page.getByRole("heading", { name: "Planned transactions", exact: true }),
	).toBeFocused();
	await expect(page).toHaveTitle("Transactions · Waypoint");
});

test("account modals have URLs, restore on back, and deep-link", async ({
	page,
}) => {
	const scenarioRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/v1/projections/stochastic"))
			scenarioRequests.push(request.url());
	});
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	await expect(page).toHaveURL(
		/\/accounts\?evidence=account&id=everyday-checking$/,
	);
	await expect(page.getByRole("dialog")).toContainText("Everyday checking");
	await page.screenshot({
		path: "test-results/router-account-evidence.png",
		fullPage: true,
	});

	// The back button closes the modal back onto the accounts page.
	await page.goBack();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();

	// Direct loads open the same modal once the account arrives.
	await page.goto("/accounts?evidence=account&id=everyday-checking");
	await expect(page.getByRole("dialog")).toContainText("Everyday checking");
	await expect(
		page.getByRole("heading", { name: "Accounts and starting balances" }),
	).toBeVisible();
	expect(scenarioRequests).toEqual([]);
});

test("unknown account slugs normalize back to the page", async ({ page }) => {
	await page.goto("/accounts?evidence=account&id=no-such-account");
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("history restores an editor's evidence return target without leaking it to a new editor", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Home value transactions" })
		.click();
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home-value$/);
	await page.getByRole("button", { name: "Add a planned transaction" }).click();
	await expect(page).toHaveURL(/\/accounts\?editor=transaction&id=new$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home-value$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/accounts$/);
	await page.goForward();
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home-value$/);
	await page.goForward();
	await expect(page).toHaveURL(/\/accounts\?editor=transaction&id=new$/);
	await expect(
		page.getByRole("dialog", { name: "Add planned transaction" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home-value$/);
	await page
		.getByRole("dialog", { name: "Home value", exact: true })
		.getByRole("button", { name: "Close dialog" })
		.click();
	await expect(page).toHaveURL(/\/accounts$/);
	await page.getByRole("button", { name: "Add account" }).click();
	await expect(
		page.getByRole("dialog", { name: "Add account", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/accounts$/);
});

test("editors have URLs and unknown editor ids normalize", async ({ page }) => {
	await page.goto("/accounts");
	await page.getByRole("button", { name: "Add account" }).click();
	await expect(page).toHaveURL(/\/accounts\?editor=account&id=new$/);
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/accounts$/);

	await page.goto("/transactions?editor=transaction&id=invest");
	const editor = page.getByRole("dialog", { name: "Monthly investing" });
	await expect(editor).toBeVisible();
	await expect(editor.getByLabel("Transaction name")).toHaveValue(
		"Monthly investing",
	);

	await page.goto("/transactions?editor=schedule&id=new");
	const scheduleDialog = page.getByRole("dialog", { name: "Add schedule" });
	await expect(scheduleDialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/transactions$/);

	await page.goto("/transactions?editor=transaction&id=no-such-transaction");
	await expect(page).toHaveURL(/\/transactions$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("target cards retain editing without an evidence dialog", async ({
	page,
}) => {
	await page.goto("/evaluations");
	const target = page.getByRole("region", { name: "Reach $750,000 net worth" });
	await expect(target.getByRole("progressbar")).toBeVisible();
	await expect(target.getByRole("button", { name: /Evidence/ })).toHaveCount(0);
	await target
		.getByRole("button", { name: "Edit Reach $750,000 net worth" })
		.click();
	await expect(page).toHaveURL(
		/\/evaluations\?editor=evaluation&id=net-worth-750k$/,
	);
	await expect(
		page.getByRole("dialog", { name: "Edit evaluation" }),
	).toBeVisible();
	await expect(page.getByLabel("Evaluation name")).toHaveValue(
		"Reach $750,000 net worth",
	);
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/evaluations$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});
