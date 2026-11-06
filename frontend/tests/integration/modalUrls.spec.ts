import { expect, test } from "./base.ts";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

for (const invalidLink of [false, true]) {
	test(`navigation from a ${invalidLink ? "malformed" : "valid"} link during verification consumes its callback once, including after Back`, async ({
		page,
	}) => {
		let release!: () => void;
		const verified = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/v1/auth/session", async (route) => {
			await verified;
			await route.continue();
		});
		try {
			await page.goto(
				invalidLink
					? "/accounts?evidence=account&id=a&id=b&gmail=connected"
					: "/accounts?gmail=connected",
			);
			await page
				.getByRole("link", { name: "Transactions", exact: true })
				.click();
			await expect(page).toHaveURL(/\/transactions\?gmail=connected$/);
			await expect(
				page.getByText("Gmail connected.", { exact: true }),
			).toHaveCount(0);
			release();
			await expect(page).toHaveURL(/\/transactions$/);
			await expect(
				page.getByRole("status").filter({ hasText: "Gmail connected." }),
			).toBeVisible();
			await expect(
				page.getByText("Gmail connected.", { exact: true }),
			).toHaveCount(1);
			await page.getByRole("button", { name: "Dismiss notification" }).click();
			await page.goBack();
			await expect(page).toHaveURL(
				invalidLink ? /\/accounts\?evidence=account&id=a&id=b$/ : /\/accounts$/,
			);
			await expect(
				page.getByText("Gmail connected.", { exact: true }),
			).toHaveCount(0);
		} finally {
			release();
		}
	});
}

for (const name of ["401", "true"]) {
	test(`account ${name} opens through generated and direct deep links`, async ({
		page,
	}) => {
		await page.goto("/accounts?editor=account&id=checking");
		await page.getByLabel("Account name").fill(name);
		await page
			.getByRole("button", { name: "Save account", exact: true })
			.click();
		await expect(page.getByRole("dialog")).not.toBeVisible();
		await page
			.getByRole("button", { name: `Open ${name} transactions`, exact: true })
			.click();
		await expect(page).toHaveURL(/\/accounts\?evidence=account&id=checking$/);
		await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
		await page.goto("/accounts?evidence=account&id=checking");
		await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
	});
}

test("malformed links show an explicit error and consume the OAuth result on the current page", async ({
	page,
}) => {
	await page.goto("/accounts?evidence=account&id=a&id=b&gmail=connected");
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=a&id=b$/);
	const error = page.getByRole("region", { name: "Invalid workspace link" });
	await expect(error).toBeVisible();
	await error.getByRole("button", { name: "Continue on this page" }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Gmail connected." }),
	).toBeVisible();
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await expect(page).toHaveURL(/\/transactions$/);
	await page.goto("/accounts?editor=account&id=new&unrelated=value");
	await expect(page).toHaveURL(/\/accounts\?editor=account&id=new$/);
	await expect(
		page.getByRole("dialog", { name: "Add account", exact: true }),
	).toBeVisible();
});

test("unknown pages retain their address and offer navigation while root opens Outlook", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await page.goto("/not-a-page?gmail=error");
	await expect(page).toHaveURL(/\/not-a-page$/);
	await expect(
		page.getByRole("region", { name: "Page not found" }),
	).toBeVisible();
	await expect(page).toHaveTitle("Page not found · Waypoint");
	await expect(page.getByRole("alert")).toContainText(
		"Gmail connection failed",
	);
	await page.screenshot({
		path: "test-results/workspace-page-not-found.png",
		fullPage: true,
	});
	await page.goBack();
	await expect(page).toHaveURL(/\/transactions$/);
	await page.goto("/accounts/no-such-subpage?evidence=account&id=checking");
	await expect(
		page.getByRole("region", { name: "Page not found" }),
	).toBeVisible();
	await expect(page).toHaveTitle("Page not found · Waypoint");
	await expect(page.getByRole("dialog")).not.toBeVisible();
	await page.goto("/?gmail=connected");
	await expect(page).toHaveURL(/\/outlook$/);
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

test("an editor copied to a fresh page preserves its evidence return destination", async ({
	page,
}) => {
	await page.goto("/accounts?evidence=account&id=home");
	await page.getByRole("button", { name: "Add a planned transaction" }).click();
	await expect(page).toHaveURL(/returnEvidence=account&returnId=home$/);
	const copied = page.url();
	await page.goto("/transactions");
	await page.goto(copied);
	await expect(
		page.getByRole("dialog", { name: "Add planned transaction" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home$/);
	await expect(
		page.getByRole("dialog", { name: "Home value", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/accounts$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/transactions$/);
});

test("account links keep their identity after renames and duplicate names", async ({
	page,
}) => {
	for (const id of ["checking", "savings"]) {
		await page.goto(`/accounts?editor=account&id=${id}`);
		await page
			.getByLabel("Account name", { exact: true })
			.fill("Shared account name");
		await page
			.getByRole("button", { name: "Save account", exact: true })
			.click();
		await expect(page.getByRole("dialog")).not.toBeVisible();
	}
	await page.goto("/accounts?evidence=account&id=checking");
	const dialog = page.getByRole("dialog", {
		name: "Shared account name",
		exact: true,
	});
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("$4,200", { exact: true })).toBeVisible();
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
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=checking$/);
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
	await page.goto("/accounts?evidence=account&id=checking");
	await expect(page.getByRole("dialog")).toContainText("Everyday checking");
	await expect(
		page.getByRole("heading", { name: "Accounts and starting balances" }),
	).toBeVisible();
	expect(scenarioRequests).toEqual([]);
});

test("unavailable account links retain their address until explicitly dismissed", async ({
	page,
}) => {
	await page.goto("/accounts?evidence=account&id=no-such-account");
	await expect(page).toHaveURL(
		/\/accounts\?evidence=account&id=no-such-account$/,
	);
	const unavailable = page.getByRole("dialog", {
		name: "Linked item unavailable",
	});
	await expect(unavailable).toContainText(
		"does not exist or is not available in this workspace",
	);
	await page.screenshot({
		path: "test-results/workspace-linked-item-unavailable.png",
		fullPage: true,
	});
	await unavailable.getByRole("button", { name: "Close dialog" }).click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("history restores an editor's evidence return target without leaking it to a new editor", async ({
	page,
}) => {
	await page.goto("/transactions");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page
		.getByRole("button", { name: "Open Home value transactions" })
		.click();
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home$/);
	await page.getByRole("button", { name: "Add a planned transaction" }).click();
	await expect(page).toHaveURL(
		/\/accounts\?editor=transaction&id=new&returnEvidence=account&returnId=home$/,
	);
	await page.goBack();
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/accounts$/);
	await page.goForward();
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home$/);
	await page.goForward();
	await expect(page).toHaveURL(
		/\/accounts\?editor=transaction&id=new&returnEvidence=account&returnId=home$/,
	);
	await expect(
		page.getByRole("dialog", { name: "Add planned transaction" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/accounts\?evidence=account&id=home$/);
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
	await page.goBack();
	await expect(page).toHaveURL(/\/transactions$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("editors have URLs and unavailable editor IDs show a dismissible error", async ({
	page,
}) => {
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
	await expect(
		page.getByRole("dialog", { name: "Linked item unavailable" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
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
