import { expect, test } from "./base.ts";
import { FIXTURE_API, readSavedServerModel, resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

test("editor navigation stays blocked while an account save is in flight", async ({
	page,
}) => {
	let notifySaving!: () => void;
	let release!: () => void;
	const saving = new Promise<void>((resolve) => {
		notifySaving = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/accounts/checking", async (route) => {
		if (route.request().method() !== "PATCH") return route.continue();
		notifySaving();
		await gate;
		await route.continue();
	});
	try {
		await page.goto("/accounts/checking");
		const dialog = page.getByRole("region", { name: "Account details" });
		await dialog.getByLabel("Account name").fill("Saved name");
		await dialog.getByRole("button", { name: "Save changes" }).click();
		await saving;
		await dialog
			.getByRole("button", { name: "Add transaction", exact: true })
			.click();
		await expect(dialog).toBeVisible();
		await expect(
			page.getByRole("dialog", { name: "Add transaction", exact: true }),
		).toHaveCount(0);
		await dialog.getByRole("tab", { name: /Recurring/ }).click();
		await dialog
			.getByRole("button", { name: "Add schedule", exact: true })
			.click();
		await expect(dialog).toBeVisible();
		await expect(
			page.getByRole("dialog", { name: "Add schedule", exact: true }),
		).toHaveCount(0);
	} finally {
		release();
	}
	await expect(page.getByLabel("Account name")).toHaveValue("Saved name");
});

test("backdated balance edits preserve later observations on all accounts", async ({
	page,
}) => {
	const initial = (
		await (await page.request.get(`${FIXTURE_API}/v1/financial-model`)).json()
	).model;
	await page.goto("/accounts/checking");
	const dialog = page.getByRole("region", { name: "Account details" });
	await dialog.getByLabel("Balance (USD)").fill("100");
	await dialog.getByLabel("Adjustment time (UTC)").fill("2026-01-30T12:00:00");
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	const saved = (
		await (await page.request.get(`${FIXTURE_API}/v1/financial-model`)).json()
	).model;
	expect(saved.checkpoints).toEqual(
		expect.arrayContaining(initial.checkpoints),
	);
	expect(saved.checkpoints).toHaveLength(initial.checkpoints.length + 1);
	await expect(dialog.getByLabel("Balance (USD)")).toHaveValue("4200");
	await expect(
		dialog.getByRole("button", {
			name: "View balance adjustment on Jan 30, 2026",
		}),
	).toBeVisible();
});

for (const recurring of [false, true]) {
	test(`dirty header confirms navigation to ${recurring ? "recurring" : "transaction"} editor`, async ({
		page,
	}) => {
		await page.goto("/accounts/checking");
		const dialog = page.getByRole("region", { name: "Account details" });
		await dialog.getByLabel("Account name").fill("Unsaved name");
		if (recurring) await dialog.getByRole("tab", { name: /Recurring/ }).click();
		const add = dialog.getByRole("button", {
			name: recurring ? "Add schedule" : "Add transaction",
			exact: true,
		});
		await add.click();
		const confirm = dialog
			.getByRole("alert")
			.filter({ hasText: "Discard the changes in this form?" });
		await expect(confirm).toBeVisible();
		await confirm
			.getByRole("button", { name: "Continue", exact: true })
			.click();
		await expect(dialog.getByLabel("Account name")).toHaveValue("Unsaved name");
		await add.click();
		await confirm
			.getByRole("button", { name: "Discard changes", exact: true })
			.click();
		await expect(dialog).toBeVisible();
		await expect(
			page.getByRole("dialog", {
				name: recurring ? "Add schedule" : "Add transaction",
				exact: true,
			}),
		).toBeVisible();
	});
}

test("an existing observation can be replaced with its pre-observation balance", async ({
	page,
}) => {
	const evidence = await page.request
		.get(`${FIXTURE_API}/v1/accounts/checking/balance-adjustments`)
		.then((response) => response.json());
	const original = evidence.adjustments[0] as {
		observedAt: number;
		previousBalance: number;
		balance: number;
	};
	expect(original.balance).not.toBe(original.previousBalance);
	await page.goto("/accounts/checking");
	const dialog = page.getByRole("region", { name: "Account details" });
	await expect(
		dialog.getByRole("button", { name: /View balance adjustment/ }),
	).toBeVisible();
	await dialog
		.getByLabel("Balance (USD)")
		.fill(String(original.previousBalance));
	await dialog
		.getByLabel("Adjustment time (UTC)")
		.fill(new Date(original.observedAt * 1000).toISOString().slice(0, 19));
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	const saved = await page.request
		.get(`${FIXTURE_API}/v1/checkpoints?accountId=checking`)
		.then((response) => response.json());
	expect(saved.checkpoints).toHaveLength(1);
	expect(saved.checkpoints[0].Balance).toBe(original.previousBalance);
	await expect(dialog.getByLabel("Balance (USD)")).toHaveValue(
		String(original.previousBalance),
	);
});

test("inline header edits save a name and a separate balance adjustment without a forecast", async ({
	page,
}) => {
	const forecasts: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/v1/projections/"))
			forecasts.push(request.url());
	});
	const initial = await readSavedServerModel();
	await page.goto("/accounts/checking");
	let dialog = page.getByRole("region", { name: "Account details" });
	await expect(dialog).not.toContainText("Account activity · Saved");
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	await dialog.getByLabel("Account name").fill("Daily cash");
	await dialog.getByRole("button", { name: "Save changes" }).click();
	dialog = page.getByRole("region", { name: "Account details" });
	await expect(dialog.getByLabel("Account name")).toHaveValue("Daily cash");
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	const previous = await page.request
		.get(`${FIXTURE_API}/v1/accounts/balances?asOf=2026-02-01T23:59:59Z`)
		.then((response) => response.json());
	const before = previous.accounts.find(
		(account: { id: string }) => account.id === "checking",
	).balance as number;
	await dialog.getByLabel("Balance (USD)").fill(String(before + 100));
	await dialog.getByLabel("Adjustment time (UTC)").fill("2026-02-01T23:59:59");
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	const model = await readSavedServerModel();
	expect(model.transactions).toEqual(initial.transactions);
	const observations = await page.request
		.get(`${FIXTURE_API}/v1/checkpoints?accountId=checking`)
		.then((response) => response.json());
	expect(observations.checkpoints).toHaveLength(2);
	expect(
		observations.checkpoints.some(
			(row: { Balance: number }) => row.Balance === before + 100,
		),
	).toBe(true);
	await dialog
		.getByRole("button", { name: "View balance adjustment on Feb 1, 2026" })
		.click();
	const adjustment = page.getByRole("dialog", {
		name: "Balance adjustment",
		exact: true,
	});
	await expect(adjustment).toContainText("$100.00");
	await expect(adjustment).toContainText(
		"It does not count as income or spending.",
	);
	await page.keyboard.press("Escape");
	await expect(adjustment).not.toBeVisible();
	await dialog.getByRole("tab", { name: "Account details" }).click();
	const settings = dialog.getByRole("region", { name: "Account settings" });
	await expect(settings.getByLabel("Account name")).toHaveCount(0);
	await expect(settings.getByLabel("Balance (USD)")).toHaveCount(0);
	expect(forecasts).toEqual([]);
});

test("header actions and inline close confirmation match transaction details", async ({
	page,
}) => {
	await page.goto("/accounts/checking");
	const dialog = page.getByRole("region", { name: "Account details" });
	await dialog.getByLabel("Account name").fill("Unsaved name");
	await dialog.getByRole("button", { name: "Accounts" }).click();
	const confirm = dialog
		.getByRole("alert")
		.filter({ hasText: "Discard the changes in this form?" });
	await confirm.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(dialog.getByLabel("Account name")).toHaveValue("Unsaved name");
	await dialog
		.getByRole("button", { name: "Discard changes", exact: true })
		.click();
	await expect(dialog.getByLabel("Account name")).toHaveValue(
		"Everyday checking",
	);
	await expect(dialog.getByLabel("Account name")).toBeFocused();
	await dialog.getByLabel("Balance (USD)").fill("9999");
	await dialog.getByRole("button", { name: "Accounts" }).click();
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(dialog.getByLabel("Balance (USD)")).toHaveValue("9999");
	await dialog
		.getByRole("button", { name: "Discard changes", exact: true })
		.click();
	await expect(dialog.getByLabel("Balance (USD)")).toBeFocused();
	await dialog.getByRole("button", { name: "Accounts" }).click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(dialog).not.toBeVisible();
});

test("failed saves retain inline values and retry creates only one adjustment", async ({
	page,
}) => {
	let fail = true;
	await page.route("**/v1/accounts/checking", (route) => {
		if (route.request().method() !== "PATCH" || !fail) return route.continue();
		return route.fulfill({
			status: 500,
			contentType: "application/json",
			headers: {
				"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
			},
			json: { error: "Adjustment save failed" },
		});
	});
	await page.goto("/accounts/checking");
	const dialog = page.getByRole("region", { name: "Account details" });
	await dialog.getByLabel("Balance (USD)").fill("9876.54");
	await dialog.getByLabel("Adjustment time (UTC)").fill("2026-02-01T23:59:59");
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(dialog.getByRole("alert")).toContainText(
		"The server failed to complete the request.",
	);
	await expect(dialog.getByLabel("Balance (USD)")).toHaveValue("9876.54");
	fail = false;
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(
		dialog.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
	const observations = await page.request
		.get(`${FIXTURE_API}/v1/checkpoints?accountId=checking`)
		.then((response) => response.json());
	expect(observations.checkpoints).toHaveLength(2);
	expect(
		observations.checkpoints.filter(
			(row: { Balance: number }) => row.Balance === 9876.54,
		),
	).toHaveLength(1);
});

test("settings persist across tabs and breadcrumb close asks before discard", async ({
	page,
}) => {
	await page.goto("/accounts/checking");
	const dialog = page.getByRole("region", { name: "Account details" });
	await dialog.getByRole("tab", { name: "Account details" }).click();
	await dialog.getByLabel("Protected balance in USD").fill("500");
	await dialog.getByRole("tab", { name: /Transactions/ }).click();
	await dialog.getByRole("tab", { name: "Account details" }).click();
	await expect(dialog.getByLabel("Protected balance in USD")).toHaveValue(
		"500",
	);
	await dialog.getByRole("button", { name: "Accounts" }).click();
	const confirm = dialog
		.getByRole("alert")
		.filter({ hasText: "Discard the changes in this form?" });
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Discard changes" }).click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(dialog).not.toBeVisible();
	const saved = await page.request
		.get(`${FIXTURE_API}/v1/financial-model`)
		.then((response) => response.json());
	expect(
		saved.model.accounts.find((row: { id: string }) => row.id === "checking")
			.minBalance,
	).toBe(0);
});
