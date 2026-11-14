import { expect, test } from "./base.ts";

// Observed during the Base UI migration: the trigger displayed the internal
// sentinel "all" rather than "All accounts", even with its popup open.
test("account selection shows labels before and after opening the popup", async ({
	page,
}) => {
	await page.goto("/flows");
	const account = page.getByRole("combobox", { name: "Account", exact: true });
	await expect(account).toContainText("All accounts");
	await account.click();
	await page.getByRole("option", { name: "All accounts", exact: true }).click();
	await expect(account).toContainText("All accounts");
});
