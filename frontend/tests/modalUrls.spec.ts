import { expect, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

test("account modals have URLs, restore on back, and deep-link", async ({
	page,
}) => {
	const scenarioRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/v1/projections/stochastic"))
			scenarioRequests.push(request.url());
	});
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	await expect(page).toHaveURL(/#accounts\/everyday-checking$/);
	await expect(page.getByRole("dialog")).toContainText("Everyday checking");

	// The back button closes the modal back onto the accounts page.
	await page.goBack();
	await expect(page).toHaveURL(/#accounts$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();

	// Direct loads open the same modal once the account arrives.
	await page.goto("/#accounts/everyday-checking");
	await expect(page.getByRole("dialog")).toContainText("Everyday checking");
	await expect(
		page.getByRole("heading", { name: "Accounts and starting balances" }),
	).toBeVisible();
	expect(scenarioRequests).toEqual([]);
});

test("unknown account slugs normalize back to the page", async ({ page }) => {
	await page.goto("/#accounts/no-such-account");
	await expect(page).toHaveURL(/#accounts$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("editors have URLs and unknown editor ids normalize", async ({ page }) => {
	await page.goto("/#accounts");
	await page.getByRole("button", { name: "Add account" }).click();
	await expect(page).toHaveURL(/#accounts\/new$/);
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/#accounts$/);

	await page.goto("/#transactions/invest/edit");
	const editor = page.getByRole("dialog", { name: "Edit planned transaction" });
	await expect(editor).toBeVisible();
	await expect(editor.getByLabel("Transaction name")).toHaveValue(
		"Monthly investing",
	);

	await page.goto("/#transactions/no-such-transaction/edit");
	await expect(page).toHaveURL(/#transactions$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("target cards retain editing without an evidence dialog", async ({
	page,
}) => {
	await page.goto("/#evaluations");
	const target = page.getByRole("region", { name: "Reach $750,000 net worth" });
	await expect(target.getByRole("progressbar")).toBeVisible();
	await expect(target.getByRole("button", { name: /Evidence/ })).toHaveCount(0);
	await target
		.getByRole("button", { name: "Edit Reach $750,000 net worth" })
		.click();
	await expect(page).toHaveURL(/#evaluations\/net-worth-750k\/edit$/);
	await expect(
		page.getByRole("dialog", { name: "Edit evaluation" }),
	).toBeVisible();
	await expect(page.getByLabel("Evaluation name")).toHaveValue(
		"Reach $750,000 net worth",
	);
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/#evaluations$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const [path, pageHash] of [
	["evaluations/net-worth-750k", "evaluations"],
	["outlook/evaluation/net-worth-750k", "outlook"],
	["outlook/net-worth-750k", "outlook"],
]) {
	test(`retired evaluation evidence URL ${path} returns to its page`, async ({
		page,
	}) => {
		await page.goto(`/#${path}`);
		await expect(page).toHaveURL(new RegExp(`#${pageHash}$`));
		await expect(page.getByRole("dialog")).not.toBeVisible();
	});
}
