import { expect, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => resetFixture());

test("current position and evidence load before the forecast", async ({
	page,
}) => {
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
		const current = page
			.locator("section")
			.filter({ has: page.getByText("Current net worth", { exact: true }) });
		const future = page
			.locator("section")
			.filter({ has: page.getByText(/^Base case in \d{4}$/) });
		await expect(current).toContainText(/\$[\d,]+/);
		await expect(current).toHaveAttribute("aria-busy", "false");
		await expect(future).toHaveAttribute("aria-busy", "true");
		await page
			.getByRole("button", { name: "Inspect current net worth evidence" })
			.click();
		await expect(page.getByRole("dialog")).toContainText(
			"The basis of your net worth",
		);
		await expect(page.getByRole("dialog")).toContainText(/\$[\d,]+/);
		await page.keyboard.press("Escape");
	} finally {
		release();
	}
	await expect(page.getByText("$1.02M")).toBeVisible();
});

test("forecast failure keeps current position visible and supports retry", async ({
	page,
}) => {
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
	const current = page
		.locator("section")
		.filter({ has: page.getByText("Current net worth", { exact: true }) });
	await expect(current).toContainText(/\$[\d,]+/);
	await expect(
		page.getByText("Forecast unavailable", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Loading the projection.", { exact: true }),
	).toHaveCount(0);
	fail = false;
	await page
		.getByRole("button", { name: "Retry forecast", exact: true })
		.click();
	await expect(page.getByText("$1.02M")).toBeVisible();
	await expect(
		page.getByText("Forecast unavailable", { exact: true }),
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
	await expect(
		page.getByText("Could not load current position."),
	).toBeVisible();
	await expect(page.getByText("$1.02M")).toBeVisible();
	fail = false;
	await page.getByRole("button", { name: "Retry current position" }).click();
	await expect(page.getByText("Could not load current position.")).toHaveCount(
		0,
	);
	await expect(
		page.getByRole("button", { name: "Inspect current net worth evidence" }),
	).toBeEnabled();
});

test("a new horizon hides the old forecast while current position stays ready", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByText("$1.02M")).toBeVisible();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/v1/projections/deterministic", async (route) => {
		await gate;
		await route.continue();
	});
	const future = page
		.locator("section")
		.filter({ has: page.getByText("Base case in 2036", { exact: true }) });
	try {
		await page.getByRole("button", { name: "10 years", exact: true }).click();
		await expect(future).toHaveAttribute("aria-busy", "true");
		await expect(page.getByText("$1.02M")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Inspect current net worth evidence" }),
		).toBeEnabled();
	} finally {
		release();
	}
	await expect(future).toHaveAttribute("aria-busy", "false");
});
