import { expect, type Page, test } from "@playwright/test";
import { readSavedServerModel, resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

async function editInvestingAmount(page: Page) {
	await page.goto("/#transactions");
	await page.getByRole("tab", { name: /Recurring/ }).click();
	await page.getByRole("button", { name: "Monthly investing" }).click();
	await page.getByLabel("Amount (USD)").click();
	await page.getByLabel("Amount (USD)").fill("900");
}

test("an ordinary save conflict preserves edits without another session check", async ({
	page,
}) => {
	const saved = await readSavedServerModel();
	await editInvestingAmount(page);
	let sessionChecks = 0;
	let writes = 0;
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/v1/auth/session") sessionChecks++;
	});
	await page.route("**/v1/recurrence-rules/*", async (route) => {
		if (route.request().method() !== "PATCH") return route.continue();
		writes++;
		return route.fulfill({
			status: 409,
			contentType: "application/problem+json",
			headers: {
				"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
			},
			json: { status: 409, detail: "That change conflicts with server data." },
		});
	});
	// Rejected writes retain the edited fields in the form.
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "That change conflicts" }),
	).toBeVisible();
	await expect(page.getByLabel("Amount (USD)")).toHaveValue("900");
	expect(sessionChecks).toBe(0);
	expect(writes).toBe(1);
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeEnabled();
	expect(await readSavedServerModel()).toEqual(saved);
});

test("a resource-change error restores the workspace without replaying the save", async ({
	page,
}) => {
	const saved = await readSavedServerModel();
	await editInvestingAmount(page);
	let sessionChecks = 0;
	let writes = 0;
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/v1/auth/session") sessionChecks++;
	});
	await page.route("**/v1/recurrence-rules/*", async (route) => {
		if (route.request().method() !== "PATCH") return route.continue();
		writes++;
		if (writes > 1) return route.continue();
		return route.fulfill({
			status: 409,
			contentType: "application/problem+json",
			json: { status: 409, code: "RESOURCE_CHANGED" },
		});
	});
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect.poll(() => sessionChecks).toBe(1);
	// A resource transition removes the old form. Its save cannot replay
	// against the newly verified scope, even when discovery returns this user.
	await expect(page.getByRole("dialog")).toHaveCount(0);
	expect(writes).toBe(1);
	expect(await readSavedServerModel()).toEqual(saved);
	await page.getByRole("tab", { name: /Recurring/ }).click();
	await page.getByRole("button", { name: "Monthly investing" }).click();
	await page.getByLabel("Amount (USD)").click();
	await expect(page.getByLabel("Amount (USD)")).toHaveValue("600");
	await page.getByLabel("Amount (USD)").fill("900");
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByText("Changes saved.")).toBeVisible();
	expect(writes).toBe(2);
	expect(
		(await readSavedServerModel()).recurrenceRules.find(
			(rule) => rule.id === "invest",
		)?.amount.config.expression,
	).toBe("900");
});
