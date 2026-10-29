import { expect, type Page, test } from "@playwright/test";
import { readSavedServerPlan, resetFixture } from "./fixture.ts";

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
	const saved = await readSavedServerPlan();
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
	// The detail editor saves immediately; the rejected save surfaces an
	// alert while the staged draft stays bannered.
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "That change conflicts" }),
	).toBeVisible();
	await expect(
		page.getByText("1 unsaved change · not saved yet"),
	).toBeVisible();
	expect(sessionChecks).toBe(0);
	expect(writes).toBe(1);
	// The failed save keeps the staged edit as an unsaved change while the
	// server plan is untouched. The detail reads saved rows, so the banner
	// is the edits-preserved evidence here.
	await expect(
		page.getByText("1 unsaved change · not saved yet"),
	).toBeVisible();
	expect(await readSavedServerPlan()).toEqual(saved);
});

test("a resource-change error restores the workspace without replaying the save", async ({
	page,
}) => {
	const saved = await readSavedServerPlan();
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
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeEnabled();
	expect(writes).toBe(1);
	expect(await readSavedServerPlan()).toEqual(saved);
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByText("Plan saved.")).toBeVisible();
	expect(writes).toBe(2);
	expect(
		(await readSavedServerPlan()).recurrenceRules.find(
			(rule) => rule.id === "invest",
		)?.amount.config.expression,
	).toBe("900");
});
