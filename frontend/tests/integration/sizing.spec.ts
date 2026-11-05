import { expect, type Locator, type Page, test } from "./base.ts";
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
	await page.getByRole("img", { name: /Net worth over the trailing/ }).hover();
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
	const chart = page.getByRole("img", {
		name: /Net worth over the trailing/,
	});
	await expect(chart).toBeAttached();
	for (const width of [320, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(chart).toHaveAttribute("tabindex", "0");
		await chart.focus();
		await expect(chart).toBeFocused();
		// TanStack owns keyboard traversal: Home and End jump to the ends of
		// the trailing window without leaving the chart surface.
		await page.keyboard.press("Home");
		await expect(chart).toBeFocused();
		await page.keyboard.press("End");
		await expect(chart).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(chart).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(chart).not.toBeFocused();
	}
});

test("chart shows no selection box on pointer click", async ({ page }) => {
	await page.goto("/");
	const chart = page.getByRole("img", {
		name: /Net worth over the trailing/,
	});
	await expect(chart).toBeAttached();
	// The surface is tabbable by design so keyboard users can inspect the
	// trailing window. Browsers paint a UA outline around a tabbable element
	// on pointer focus; the stylesheet must suppress that one case, while a
	// keyboard focus keeps the shared :focus-visible ring.
	await chart.click();
	await expect(chart).toBeFocused();
	const clicked = await chart.evaluate((element) => ({
		focusVisible: element.matches(":focus-visible"),
		outlineStyle: getComputedStyle(element).outlineStyle,
	}));
	expect(clicked.focusVisible).toBe(false);
	expect(clicked.outlineStyle).toBe("none");
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();
	});
	// Tab from the page start, like a keyboard user. Playwright focus() is
	// programmatic, and a programmatic focus right after a pointer click does
	// not reliably match :focus-visible.
	for (let tab = 0; tab < 40; tab++) {
		await page.keyboard.press("Tab");
		if (await chart.evaluate((element) => element.matches(":focus"))) break;
	}
	await expect(chart).toBeFocused();
	const keyboard = await chart.evaluate((element) => ({
		focusVisible: element.matches(":focus-visible"),
		outlineStyle: getComputedStyle(element).outlineStyle,
	}));
	expect(keyboard.focusVisible).toBe(true);
	expect(keyboard.outlineStyle).not.toBe("none");
});

test("outlook summary keeps full width on a narrow phone", async ({ page }) => {
	// Below sm the summary stacks above its controls; side by side the
	// flex-1 summary can collapse to leftover width beside them and the
	// anywhere-wrapping value breaks character by character.
	// 320px documents the phone; 480px pins the crush equilibrium, where the
	// old side-by-side header left the value leftover width.
	for (const width of [320, 480]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/");
		const region = page.getByRole("region", {
			name: /Net worth over the trailing/,
		});
		const header = region.locator(":scope > div > div").first();
		const columns = header.locator(":scope > div");
		await expect(columns.first()).toBeVisible();
		await expect(columns.nth(1)).toBeVisible();
		const summaryBox = await columns.first().boundingBox();
		const actionsBox = await columns.nth(1).boundingBox();
		expect(summaryBox).not.toBeNull();
		expect(actionsBox).not.toBeNull();
		expect(actionsBox!.y).toBeGreaterThanOrEqual(
			summaryBox!.y + summaryBox!.height - 2,
		);
		const value = columns.first().locator("strong").first();
		const valueBox = await value.boundingBox();
		expect(valueBox).not.toBeNull();
		// A crushed value measured ~60px wide with one digit per line;
		// healthy text-3xl digits need ~130px. Above that rules out the squish.
		expect(valueBox!.width).toBeGreaterThan(110);
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
	test(`failed-save forms and notifications remain usable at ${width}px`, async ({
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
		// The dialog closes after the row save succeeds.
		await page.getByLabel("Account name").press("Enter");
		await expect(dialog).not.toBeVisible();
		await expect(
			page.getByRole("row", { name: /Sizing regression/ }),
		).toBeVisible();
		// A rejected row save retains its form and shows the server error.
		await page.route("**/v1/schedules/**", async (route) => {
			if (route.request().method() !== "POST") return route.continue();
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
		const detail = page.getByRole("dialog", { name: "Monthly investing" });
		await expect(detail).toBeVisible();
		await expectWithinViewport(detail, page);
		await expect(page.getByLabel("Amount (USD)")).toHaveValue("900");
		const save = detail.getByRole("button", { name: "Save changes" });
		await save.scrollIntoViewIfNeeded();
		await expectWithinViewport(save, page);
		const notice = page
			.getByRole("alert")
			.filter({ hasText: "Sizing check holds" });
		await expect(notice).toBeVisible();
		// Retry from the same form, with the original edited fields intact.
		await page.unroute("**/v1/schedules/**");
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(page.getByText("Changes saved.")).toBeVisible();
		await expect(detail).not.toBeVisible();
		await expectWithinViewport(
			page.getByRole("status").filter({ hasText: "Changes saved." }),
			page,
		);
	});
}
