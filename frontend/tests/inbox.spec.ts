import { expect, type Page, test } from "./base.ts";
import {
	readSavedServerModel,
	resetFixture,
	seedInboxFixture,
} from "./fixture.ts";

const SEED = [
	{ name: "Lake cabin groceries", amount: "60", day: "2026-06-15" },
	{ name: "Lake cabin fuel", amount: "18.25", day: "2026-06-16" },
];

async function openInbox(page: Page) {
	await page.goto("/");
	// The unread badge appends to the accessible name once shares land.
	await page.getByRole("link", { name: "Inbox" }).click();
	await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
	return page.getByRole("region", { name: "Inbox" });
}

test("inbox tabs render empty states when nothing is shared", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await resetFixture();
	const inbox = await openInbox(page);

	await expect(inbox.getByText("Nothing waiting")).toBeVisible();
	await inbox.getByRole("tab", { name: "Accepted" }).click();
	await expect(inbox.getByText("Nothing accepted yet")).toBeVisible();
	await inbox.getByRole("tab", { name: "Declined" }).click();
	await expect(inbox.getByText("Nothing declined")).toBeVisible();
	await inbox.getByRole("tab", { name: "Canceled" }).click();
	await expect(inbox.getByText("Nothing taken back")).toBeVisible();
	expect(errors).toEqual([]);
});

test("inbox lists pending direct shares", async ({ page }) => {
	await resetFixture();
	await seedInboxFixture(SEED);
	const inbox = await openInbox(page);

	await expect(
		inbox.getByText("Lake cabin groceries", { exact: true }),
	).toBeVisible();
	// Direct shares with no common group carry no sender display name.
	// (The page header also matches, so count inside the cards only.)
	const cards = inbox.getByRole("article");
	await expect(cards).toHaveCount(2);
	await expect(cards.getByText("Shared with you")).toHaveCount(2);
});

test("inbox accept saves an independent copy to the viewer model", async ({
	page,
}) => {
	await resetFixture();
	await seedInboxFixture([SEED[0]!]);
	const inbox = await openInbox(page);
	await expect(
		inbox.getByText("Lake cabin groceries", { exact: true }),
	).toBeVisible();

	await inbox
		.getByRole("button", { name: "Accept and save a copy" })
		.click();
	await expect(
		page.getByText("Share accepted and saved to your records."),
	).toBeVisible();

	// The pending tab drains; the accepted tab keeps the share with its
	// copy note.
	await expect(inbox.getByText("Nothing waiting")).toBeVisible();
	await inbox.getByRole("tab", { name: "Accepted" }).click();
	await expect(
		inbox.getByText("Lake cabin groceries", { exact: true }),
	).toBeVisible();
	await expect(
		inbox.getByText("Saved to your own records as an independent copy."),
	).toBeVisible();

	const model = await readSavedServerModel();
	expect(
		model.postings.some(
			(posting) => posting.name === "Lake cabin groceries",
		),
	).toBe(true);
});

test("inbox decline moves the share to declined", async ({ page }) => {
	await resetFixture();
	await seedInboxFixture([SEED[0]!]);
	const inbox = await openInbox(page);
	await expect(
		inbox.getByText("Lake cabin groceries", { exact: true }),
	).toBeVisible();

	await inbox.getByRole("button", { name: "Decline", exact: true }).click();
	await expect(page.getByText("Share declined.")).toBeVisible();

	// Declining a direct share withdraws the grant, so the declined card
	// keeps no content: one anonymous card with the unavailable note.
	await expect(inbox.getByText("Nothing waiting")).toBeVisible();
	await inbox.getByRole("tab", { name: "Declined" }).click();
	await expect(inbox.getByRole("article")).toHaveCount(1);
	await expect(
		inbox.getByText("This share is no longer available to view."),
	).toBeVisible();
});

test("inbox shows revoked shares as canceled", async ({ page }) => {
	await resetFixture();
	await seedInboxFixture(SEED, ["Lake cabin fuel"]);
	const inbox = await openInbox(page);

	await expect(
		inbox.getByText("Lake cabin groceries", { exact: true }),
	).toBeVisible();
	await expect(
		inbox.getByText("Lake cabin fuel", { exact: true }),
	).toBeHidden();

	// A taken-back share keeps no content: one anonymous card with the
	// taken-back note, while the live share stays out of this tab.
	await inbox.getByRole("tab", { name: "Canceled" }).click();
	await expect(inbox.getByRole("article")).toHaveCount(1);
	await expect(
		inbox.getByText("This share was taken back before you decided."),
	).toBeVisible();
	await expect(
		inbox.getByText("Lake cabin groceries", { exact: true }),
	).toBeHidden();
});
