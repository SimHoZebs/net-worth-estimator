import { expect, test } from "./base.ts";

// Production returned 422 for the owner's balances while other rows loaded.
// A failed prerequisite must not leave Outlook's forecast disabled forever.
test("Outlook reports failed balances and retries instead of loading forever", async ({
	page,
}) => {
	let failing = true;
	await page.route("**/v1/accounts/balances*", async (route) => {
		if (!failing) return route.continue();
		await route.fulfill({
			status: 422,
			contentType: "application/problem+json",
			body: JSON.stringify({
				title: "Account balances could not be calculated",
				detail: "Synthetic invalid financial model.",
				status: 422,
			}),
		});
	});
	await page.goto("/outlook");
	const error = page.getByRole("alert", { name: "Outlook account balances" });
	await expect(error).toContainText("Account balances could not be loaded.");
	await expect(error).toContainText("Synthetic invalid financial model.");
	await expect(
		page.getByRole("region", { name: "Safe spending", exact: true }),
	).toHaveCount(0);
	failing = false;
	const loaded = page.waitForResponse(
		(response) =>
			new URL(response.url(), page.url()).pathname ===
				"/v1/accounts/balances" && response.ok(),
	);
	await error.getByRole("button", { name: "Retry", exact: true }).click();
	await loaded;
	await expect(error).toHaveCount(0);
	await expect(
		page.getByRole("region", { name: "Safe spending", exact: true }),
	).toBeVisible();
	await expect(
		page
			.getByRole("region", { name: "Safe spending", exact: true })
			.locator('[aria-busy="true"]'),
	).toHaveCount(0);
});
