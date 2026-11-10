import { expect, type Page, test } from "./base.ts";
import {
	FIXTURE_API,
	readSavedServerModel,
	seedSharingFixture,
} from "./fixture.ts";

const SEED = [
	{ name: "Cabin groceries", amount: "42.50", day: "2026-06-15" },
	{ name: "Cabin fuel", amount: "18", day: "2026-06-16" },
	{ name: "Cabin estimate", amount: "share * 2", day: "2026-06-17" },
	{ name: "Cabin dinner", amount: "25", day: "2026-06-18", pending: true },
];

async function openSeededGroup(page: Page, groupName: string) {
	await page.goto("/");
	await page.getByRole("link", { name: "Groups", exact: true }).click();
	await page
		.getByRole("listitem")
		.filter({ hasText: groupName })
		.getByRole("button", { name: "Open" })
		.click();
	await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
	return page.getByRole("region", { name: "Shared feed" });
}

test("group feed lists shared transactions with viewer totals", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await seedSharingFixture("Cabin totals", "Dana", SEED);
	const feed = await openSeededGroup(page, "Cabin totals");

	await expect(
		feed.getByText("Cabin groceries", { exact: true }),
	).toBeVisible();
	await expect(feed.getByText("Cabin fuel", { exact: true })).toBeVisible();
	await expect(feed.getByText("Cabin estimate", { exact: true })).toBeVisible();
	await expect(feed.getByText("Cabin dinner", { exact: true })).toBeVisible();
	// Source member, authorized amounts, pending marker, calculated recipe.
	await expect(feed.getByText(/Shared by Dana/)).toHaveCount(4);
	await expect(feed.getByText("Jun 15, 2026").first()).toBeVisible();
	await expect(feed.getByText("−$42.50")).toBeVisible();
	await expect(feed.getByText("Varies", { exact: true })).toBeVisible();
	await expect(feed.getByText(/Pending/)).toBeVisible();
	// Viewer-specific totals describe the whole filtered set.
	await expect(
		feed.getByText(
			"4 transactions · $85.50 shared · 1 calculated amount not summed · 1 pending",
		),
	).toBeVisible();
	expect(errors).toEqual([]);
});

test("group feed filters narrow rows and totals together", async ({ page }) => {
	await seedSharingFixture("Cabin filters", "Dana", SEED);
	const feed = await openSeededGroup(page, "Cabin filters");
	await expect(
		feed.getByText("Cabin groceries", { exact: true }),
	).toBeVisible();

	await feed.getByLabel("From date").fill("2026-06-16");
	await feed.getByLabel("To date").fill("2026-06-17");
	await expect(feed.getByText("Cabin groceries", { exact: true })).toBeHidden();
	await expect(feed.getByText("Cabin fuel", { exact: true })).toBeVisible();
	await expect(feed.getByText("Cabin estimate", { exact: true })).toBeVisible();
	await expect(
		feed.getByText(
			"2 transactions · $18.00 shared · 1 calculated amount not summed",
		),
	).toBeVisible();

	await feed.getByLabel("Movement").selectOption("in");
	await expect(feed.getByText("No shared transactions")).toBeVisible();
	await expect(feed.getByText("0 transactions · $0.00 shared")).toBeVisible();
});

test("group feed saves an independent copy to the viewer model", async ({
	page,
	request,
}) => {
	await seedSharingFixture("Cabin copy", "Dana", SEED);
	const feed = await openSeededGroup(page, "Cabin copy");
	await expect(
		feed.getByText("Cabin groceries", { exact: true }),
	).toBeVisible();

	await feed
		.getByRole("button", { name: /Save a copy of Cabin groceries/ })
		.click();
	await expect(feed.getByText("Saved", { exact: true })).toBeVisible();
	await expect(page.getByText("Saved to your transactions")).toBeVisible();

	// The copy is an ordinary row in the viewer's own model.
	const model = await readSavedServerModel();
	expect(
		model.transactions.some(
			(transaction) => transaction.name === "Cabin groceries",
		),
	).toBe(true);
	// The seeded owner resource stays out of the viewer's model scope.
	const owners = await request.get(`${FIXTURE_API}/v1/financial-model`);
	expect(owners.ok()).toBe(true);
});
