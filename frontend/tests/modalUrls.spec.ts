import { expect, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

test("account modals have URLs, restore on back, and deep-link", async ({
	page,
}) => {
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

	// Direct loads open the same modal once the plan arrives.
	await page.goto("/#accounts/everyday-checking");
	await expect(page.getByRole("dialog")).toContainText("Everyday checking");
	await expect(
		page.getByRole("heading", { name: "Accounts and starting balances" }),
	).toBeVisible();
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
	await expect(page.getByRole("dialog")).toContainText("Monthly investing");

	await page.goto("/#transactions/no-such-movement/edit");
	await expect(page).toHaveURL(/#transactions$/);
	await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("evaluation evidence deep-links onto its page", async ({ page }) => {
	await page.goto("/#evaluations/net-worth-750k");
	await expect(page.getByRole("dialog")).toContainText(
		"Reach $750,000 net worth",
	);
	await expect(
		page.getByRole("heading", { name: "Check what the plan supports" }),
	).toBeVisible();
});
