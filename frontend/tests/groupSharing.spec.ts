import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

/** Create a group through the UI and land on its detail page. */
async function createGroup(page: Page) {
	await page.goto("/#groups");
	await page
		.getByRole("button", { name: "Create group" })
		.first()
		.click();
	const dialog = page.getByRole("dialog", { name: "Create group" });
	await dialog.getByLabel("Group name").fill("Browser club");
	await dialog.getByRole("button", { name: "Create group" }).click();
	await expect(
		page.getByRole("heading", { name: "Browser club" }),
	).toBeVisible();
}

test("fixture reset clears groups between tests", async ({ page }) => {
	await createGroup(page);
	await expect(
		page.getByRole("heading", { name: "Browser club" }),
	).toBeVisible();
	// The harness reset must remove the group, its membership, and its
	// sharing state so later tests start from an empty baseline. Reload
	// clears the client cache so the list reflects the reset server.
	await resetFixture();
	await page.reload();
	await page.goto("/#groups");
	await expect(page.getByText("No groups yet")).toBeVisible();
});

test("enabling policy lists own rows in the group feed", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await createGroup(page);

	const feed = page.getByRole("region", { name: "Shared feed" });
	await expect(feed).toContainText("No shared transactions");

	// Enabling automatic sharing refreshes the feed above the consent
	// section with no manual reload: the owner's newly shared rows list.
	const sharing = page.getByRole("region", { name: "My sharing" });
	await sharing.getByRole("button", { name: /Everyday checking/ }).click();
	await sharing.getByLabel("Share from").fill("2026-01-01");
	await sharing.getByRole("button", { name: "Turn on sharing" }).click();
	await expect(sharing).toContainText(
		"Automatic sharing is on for this group.",
	);
	await expect(feed).toContainText(/4 transactions/);
	expect(errors).toEqual([]);
});

test("group sharing consent stays off until the member opts in", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await createGroup(page);

	// Off by default with no admin override: only this member can opt in.
	const sharing = page.getByRole("region", { name: "My sharing" });
	await expect(sharing).toContainText(
		"Automatic sharing is off. Only you can turn it on.",
	);

	// Selecting an owned account and a start date counts the live exposure
	// on the server and warns about historical disclosure before enabling.
	await sharing.getByRole("button", { name: "Everyday checking" }).click();
	await sharing.getByLabel("Share from").fill("2026-01-01");
	await expect(sharing).toContainText(
		/later bank imports can add older matching/,
	);
	await expect(sharing).toContainText(/match this selection for 1 member/);
	await expect(sharing).not.toContainText("$");

	// Enabling then disabling flips the member's own opt-in state.
	await sharing.getByRole("button", { name: "Turn on sharing" }).click();
	await expect(sharing).toContainText(
		"Automatic sharing is on for this group.",
	);
	await sharing
		.getByRole("button", { name: "Turn off automatic sharing" })
		.click();
	await expect(sharing).toContainText(
		"Automatic sharing is off. Only you can turn it on.",
	);

	const violations = await new AxeBuilder({ page })
		.include('section[aria-label="My sharing"]')
		.analyze();
	expect(
		violations.violations.map((violation) => violation.id),
		"No new accessibility violations in the sharing consent section",
	).toEqual([]);
	expect(errors).toEqual([]);
});
