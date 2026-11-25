import { expect, test, type Locator, type Page } from "./base.ts";

// The account page used a sticky footer inside the document scroll, so on a
// phone it covered the last activity row. Mobile now pins the footer to the
// viewport as a parent-level surface while the page reserves matching scroll
// space; desktop keeps its original sticky inline bar.
const ACTION_BAR = "[data-account-action-bar]";

async function openAccount(page: Page, path = "/accounts/checking") {
	await page.goto(path);
	const bar = page.locator(ACTION_BAR);
	await expect(bar).toBeVisible();
	return bar;
}

async function barPosition(bar: Locator) {
	return bar.evaluate((element) => getComputedStyle(element).position);
}

async function scrollToBottom(page: Page) {
	await page.evaluate(() =>
		window.scrollTo(0, document.documentElement.scrollHeight),
	);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const documentElement = document.documentElement;
				return (
					documentElement.scrollHeight -
					documentElement.scrollTop -
					documentElement.clientHeight
				);
			}),
		)
		.toBeLessThanOrEqual(2);
	return page.evaluate(() => document.documentElement.scrollTop);
}

async function assertMobileGeometry(page: Page, bar: Locator) {
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("viewport missing");
	const box = await bar.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x).toBeLessThanOrEqual(1);
	expect(box!.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box!.x + box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
	expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 1);
	expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
	expect(await barPosition(bar)).toBe("fixed");

	const parent = await bar.evaluate(
		(element) => element.parentElement?.getAttribute("aria-label") ?? null,
	);
	expect(parent).toBe("Account details");
	const insideTab = await bar.evaluate((element) =>
		Boolean(element.closest('[role="tabpanel"]')),
	);
	expect(insideTab).toBe(false);
	await expect(bar.getByRole("button", { name: "Cancel" })).toBeVisible();
	await expect(bar.getByRole("button", { name: "Save changes" })).toBeVisible();

	const overflow = await page.evaluate(() => ({
		document: document.documentElement.scrollWidth,
		viewport: window.innerWidth,
	}));
	expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
	return box!;
}

test.describe("account detail mobile action bar", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("pins a full-width bar to the viewport below the tabs", async ({
		page,
	}) => {
		await assertMobileGeometry(page, await openAccount(page));
	});

	test("scrolls the last activity row fully above the bar", async ({
		page,
	}) => {
		const bar = await openAccount(page);
		const activity = page.locator('[data-slot="tabs-content"]').first();
		await expect(activity).toBeVisible();
		const before = await bar.boundingBox();
		expect(await scrollToBottom(page)).toBeGreaterThan(0);
		const after = await bar.boundingBox();
		expect(after!.y).toBeCloseTo(before!.y, 0);
		const activityBox = await activity.boundingBox();
		expect(activityBox).not.toBeNull();
		expect(activityBox!.y + activityBox!.height).toBeLessThanOrEqual(
			after!.y + 1,
		);
	});

	test("submits the account form from the fixed bar", async ({ page }) => {
		const bar = await openAccount(page);
		const name = page.getByLabel("Account name");
		const save = bar.getByRole("button", { name: "Save changes" });
		await expect(save).toBeDisabled();
		const saved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/v1/accounts/checking" &&
				response.request().method() === "PATCH",
		);
		await name.fill("Footer layout checking");
		await expect(save).toBeEnabled();
		await save.click();
		expect((await saved).status()).toBe(200);
		await expect(name).toHaveValue("Footer layout checking");
	});

	test("keeps the discard guard and clean cancel on the fixed bar", async ({
		page,
	}) => {
		const bar = await openAccount(page);
		await page.getByLabel("Account name").fill("Unsaved footer change");
		await bar.getByRole("button", { name: "Cancel" }).click();
		const confirm = page.getByRole("alertdialog", {
			name: "Discard unsaved changes?",
		});
		await expect(confirm).toBeVisible();
		await confirm.getByRole("button", { name: "Continue editing" }).click();
		await expect(confirm).toBeHidden();
		await expect(bar).toBeVisible();
		await bar.getByRole("button", { name: "Cancel" }).click();
		await confirm.getByRole("button", { name: "Discard changes" }).click();
		await expect(page).toHaveURL(/\/accounts$/);
	});
});

test.describe("account detail narrow mobile action bar", () => {
	test.use({ viewport: { width: 320, height: 700 } });

	test("spans the viewport and reserves scroll space at 320px", async ({
		page,
	}) => {
		const bar = await openAccount(page);
		await assertMobileGeometry(page, bar);
		const activity = page.locator('[data-slot="tabs-content"]').first();
		await expect(activity).toBeVisible();
		expect(await scrollToBottom(page)).toBeGreaterThan(0);
		const barBox = await bar.boundingBox();
		const activityBox = await activity.boundingBox();
		expect(activityBox!.y + activityBox!.height).toBeLessThanOrEqual(
			barBox!.y + 1,
		);
	});
});

test.describe("account detail long transaction list", () => {
	test.use({
		viewport: { width: 320, height: 700 },
		fixtureOptions: { bulk: "1x40:7" },
	});

	test("keeps the fixed bar still while a long list scrolls above it", async ({
		page,
	}) => {
		const bar = await openAccount(page, "/accounts/seed-acct-7-0000");
		expect(
			await page.locator('[data-slot="table-row"]').count(),
		).toBeGreaterThanOrEqual(10);
		const before = await assertMobileGeometry(page, bar);
		expect(await scrollToBottom(page)).toBeGreaterThan(0);
		const after = await bar.boundingBox();
		expect(after!.y).toBeCloseTo(before.y, 0);
		const activity = page.locator('[data-slot="tabs-content"]').first();
		const activityBox = await activity.boundingBox();
		expect(activityBox).not.toBeNull();
		expect(activityBox!.y + activityBox!.height).toBeLessThanOrEqual(
			after!.y + 1,
		);
	});
});

test.describe("account detail desktop action bar", () => {
	test.use({ viewport: { width: 1440, height: 1080 } });

	test("retains the sticky inline bar inside the page content", async ({
		page,
	}) => {
		const bar = await openAccount(page);
		expect(await barPosition(bar)).toBe("sticky");
		const box = await bar.boundingBox();
		const viewport = page.viewportSize();
		if (!viewport) throw new Error("viewport missing");
		expect(box!.x).toBeGreaterThan(0);
		expect(box!.x + box!.width).toBeLessThan(viewport.width);
		const parent = await bar.evaluate(
			(element) => element.parentElement?.getAttribute("aria-label") ?? null,
		);
		expect(parent).toBe("Account details");
		await expect(bar.getByRole("button", { name: "Cancel" })).toBeVisible();
		await expect(
			bar.getByRole("button", { name: "Save changes" }),
		).toBeVisible();
	});
});
