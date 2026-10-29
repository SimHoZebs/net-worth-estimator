import { expect, type Locator, type Page, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function expectWithinViewport(element: Locator, page: Page) {
	const box = await element.boundingBox();
	expect(box).not.toBeNull();
	const viewport = page.viewportSize()!;
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("navigation remains usable after a phone-to-desktop resize", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/");
	await page.getByRole("button", { name: "Open navigation" }).click();
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 480 });
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).toHaveCount(0);
	await page.getByRole("slider", { name: "Inspect net worth date" }).hover();
	const initialScroll = await page.evaluate(() => window.scrollY);
	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(initialScroll);
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page).toHaveURL(/#accounts$/);
	await page.getByRole("button", { name: "Add account" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
});

test("projection inspection remains keyboard-accessible after resize", async ({
	page,
}) => {
	await page.goto("/");
	const slider = page.getByRole("slider", { name: "Inspect net worth date" });
	await expect(slider).toBeAttached();
	for (const width of [320, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		const initialValue = await slider.getAttribute("aria-valuetext");
		const maximum = await slider.getAttribute("max");
		const minimum = await slider.getAttribute("min");
		expect(initialValue).not.toBeNull();
		expect(maximum).not.toBeNull();
		expect(minimum).not.toBeNull();
		await slider.focus();
		// The trailing graph defaults to today, the last point, so keyboard
		// inspection moves toward the start of the window.
		await expect(slider).toHaveValue(maximum!);
		await slider.press("Home");
		await expect(slider).toHaveValue(minimum!);
		await expect(slider).not.toHaveAttribute("aria-valuetext", initialValue!);
		await slider.press("Tab");
		await expect(slider).not.toBeFocused();
	}
});

test("account sheet controls remain usable across responsive resizes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Everyday checking" });
	await expect(sheet).toBeVisible();
	for (const width of [320, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expectWithinViewport(sheet, page);
		await expect(sheet.getByLabel("Transaction source")).toBeVisible();
		await expect(
			sheet.getByRole("button", { name: "Close dialog" }),
		).toBeVisible();
	}
	await sheet.getByRole("button", { name: "Close dialog" }).click();
	await expect(sheet).not.toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
	test(`draft actions and notifications reserve their own space at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/#accounts");
		await page.getByRole("button", { name: "Add account" }).click();
		const dialog = page.getByRole("dialog", { name: "Add account" });
		await expect(dialog).toBeVisible();
		await expectWithinViewport(dialog, page);
		await page.getByLabel("Account name").fill("Sizing regression");
		await page.getByLabel("Balance (USD)", { exact: true }).fill("2500");
		// Submit through the native form interaction, not an internal event handler.
		// Accounts save straight to the server, so the dialog closes with no draft.
		await page.getByLabel("Account name").press("Enter");
		await expect(dialog).not.toBeVisible();
		await expect(
			page.getByRole("row", { name: /Sizing regression/ }),
		).toBeVisible();
		// Stage a transaction edit and hold its save: the retained draft
		// keeps the banner mounted for the layout checks below. Edits save
		// immediately now, so only a failed save leaves a banner behind.
		await page.route("**/v1/recurrence-rules/*", async (route) => {
			if (route.request().method() !== "PATCH") return route.continue();
			return route.fulfill({
				status: 409,
				contentType: "application/problem+json",
				json: { status: 409, detail: "Sizing check holds the save." },
			});
		});
		await page.goto("/#transactions");
		await page.getByRole("tab", { name: /Recurring/ }).click();
		await page.getByRole("button", { name: "Monthly investing" }).click();
		await page.getByLabel("Amount (USD)").click();
		await page.getByLabel("Amount (USD)").fill("900");
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(
			page.getByRole("dialog", { name: "Monthly investing" }),
		).not.toBeVisible();
		const bar = page.locator("[data-draft-bar]");
		await expect(bar).toBeVisible();
		await expectWithinViewport(bar, page);
		const notice = page.getByRole("status").filter({ hasText: "Unsaved" });
		await expect(notice).toBeVisible();
		await expectWithinViewport(notice, page);
		// Notifications sit above the bar, independent of wrapping.
		const notificationBox = await notice.boundingBox();
		const initialBarBox = await bar.boundingBox();
		expect(notificationBox!.y + notificationBox!.height).toBeLessThanOrEqual(
			initialBarBox!.y,
		);
		await page.goto("/#sources");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		// The assumptions live behind their Configs tab since the tabbed layout.
		await page.getByRole("tab", { name: "Assumptions" }).click();
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expectWithinViewport(bar, page);
		const lastField = page.getByLabel("Investment return variability (%)");
		await expectWithinViewport(lastField, page);
		const fieldBox = await lastField.boundingBox();
		const barBox = await bar.boundingBox();
		expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
		await lastField.click();
		await expect(lastField).toBeFocused();
		// Release the held save and persist the retained draft from the
		// banner; the bar unmounts once the save lands.
		await page.unroute("**/v1/recurrence-rules/*");
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(page.getByText("Plan saved.")).toBeVisible();
		await expect(bar).toHaveCount(0);
		await expectWithinViewport(
			page.getByRole("status").filter({ hasText: "Plan saved." }),
			page,
		);
	});
}
