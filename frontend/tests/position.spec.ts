import { expect, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

test("evidence loads before the forecast", async ({ page }) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/projections/deterministic", async (route) => {
		await gate;
		await route.continue();
	});
	try {
		await page.goto("/");
		// The history graph stays empty while the forecast is gated, but the
		// evidence action does not depend on it.
		await expect(
			page.getByRole("slider", { name: "Inspect net worth date" }),
		).toHaveCount(0);
		const evidence = page.getByRole("button", {
			name: "Inspect current net worth evidence",
		});
		await expect(evidence).toBeVisible();
		await expect(evidence).toBeEnabled();
		await evidence.click();
		await expect(page.getByRole("dialog")).toContainText(
			"The basis of your net worth",
		);
		await expect(page.getByRole("dialog")).toContainText("$361,200");
		await page.keyboard.press("Escape");
	} finally {
		release();
	}
	await expect(
		page.getByRole("slider", { name: "Inspect net worth date" }),
	).toBeVisible();
});

test("forecast failure supports retry", async ({ page }) => {
	let fail = true;
	await page.route("**/v1/projections/deterministic", async (route) => {
		if (!fail) return route.continue();
		return route.fulfill({
			status: 500,
			contentType: "application/json",
			headers: {
				"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
			},
			json: { error: "Forecast unavailable for test" },
		});
	});
	await page.goto("/");
	await expect(
		page.getByText("Could not calculate forecast.", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByText("Loading the projection.", { exact: true }),
	).toHaveCount(0);
	fail = false;
	await page
		.getByRole("button", { name: "Retry forecast", exact: true })
		.click();
	await expect(
		page.getByRole("slider", { name: "Inspect net worth date" }),
	).toBeVisible();
	await expect(
		page.getByText("Could not calculate forecast.", { exact: false }),
	).toHaveCount(0);
});

test("position failure does not block the forecast", async ({ page }) => {
	let fail = true;
	await page.route("**/v1/position", async (route) => {
		if (!fail) return route.continue();
		return route.fulfill({
			status: 500,
			contentType: "application/json",
			headers: {
				"Waypoint-Resource": route.request().headers()["waypoint-resource"]!,
			},
			json: { error: "Position unavailable for test" },
		});
	});
	await page.goto("/");
	// The forecast graph loads from the deterministic projection, independent
	// of the failed position request.
	await expect(
		page.getByRole("slider", { name: "Inspect net worth date" }),
	).toBeVisible();
	// The evidence dialog owns the position request, so its error and retry
	// live there too.
	await page
		.getByRole("button", { name: "Inspect current net worth evidence" })
		.click();
	await expect(page.getByRole("dialog")).toContainText(
		"Could not load current position.",
	);
	fail = false;
	await page.getByRole("button", { name: "Retry current position" }).click();
	await expect(page.getByRole("dialog")).toContainText("$361,200");
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Inspect current net worth evidence" }),
	).toBeEnabled();
});
