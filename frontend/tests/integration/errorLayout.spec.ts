import { expect, test } from "./base.ts";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

for (const viewport of [
	{ width: 1440, height: 1080 },
	{ width: 390, height: 844 },
]) {
	test(`account validation and failed retries keep controls stationary at ${viewport.width}px`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await page.route("**/v1/accounts", async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			return route.fulfill({
				status: 503,
				contentType: "application/json",
				headers: {
					"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
				},
				json: { error: "The server is unavailable." },
			});
		});
		await page.goto("/accounts");
		await page
			.getByRole("button", { name: "Add account", exact: true })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "Add account",
			exact: true,
		});
		const name = dialog.getByLabel("Account name");
		const save = dialog.getByRole("button", {
			name: "Add account",
			exact: true,
		});
		await name.fill("   ");
		await save.scrollIntoViewIfNeeded();
		const positions = async () => ({
			dialog: await dialog.boundingBox(),
			name: await name.boundingBox(),
			save: await save.boundingBox(),
		});
		const before = await positions();
		await save.click();
		await expect(dialog.getByRole("alert")).toContainText(
			"Give the account a name.",
		);
		expect(await positions()).toEqual(before);
		await name.fill("Layout test");
		await save.scrollIntoViewIfNeeded();
		const valid = await positions();
		for (let attempt = 0; attempt < 2; attempt++) {
			await save.click();
			await expect(dialog.getByRole("alert")).toContainText(
				"The account could not be saved.",
			);
			await expect(save).toBeEnabled();
			expect(await positions()).toEqual(valid);
		}
	});
}
