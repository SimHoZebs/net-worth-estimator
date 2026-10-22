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

test("navigation, chart inspection, and page width agree at stock breakpoint boundaries", async ({
	page,
}) => {
	await page.goto("/");
	const chart = page.getByRole("region", { name: "Net worth over time" });
	const slider = chart.getByRole("slider");
	await expect(slider).toBeAttached();
	for (const width of [
		320, 390, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1535, 1536,
	]) {
		await page.setViewportSize({ width, height: 900 });
		const opener = page.getByRole("button", { name: "Open navigation" });
		if (width < 768) {
			await expect(opener).toBeVisible();
			await expect(
				page.getByRole("complementary", { name: "Workspace navigation" }),
			).toHaveCount(0);
		} else {
			await expect(opener).not.toBeVisible();
			await expect(
				page.getByRole("complementary", { name: "Workspace navigation" }),
			).toBeVisible();
		}
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
				message: `page at ${width}px`,
			})
			.toBeLessThanOrEqual(width);
		await expect(chart.getByRole("img")).toHaveAttribute(
			"viewBox",
			width < 640 ? "0 0 440 260" : "0 0 820 280",
		);
		const plot = await chart.getByRole("img").boundingBox();
		const inspection = await slider.boundingBox();
		expect(inspection!.width).toBeGreaterThan(plot!.width / 2);
		expect(inspection!.x).toBeGreaterThan(plot!.x);
		expect(inspection!.x + inspection!.width).toBeLessThan(
			plot!.x + plot!.width,
		);
	}
	await page.setViewportSize({ width: 767, height: 900 });
	await page.getByRole("button", { name: "Open navigation" }).click();
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).toBeVisible();
	await page.setViewportSize({ width: 768, height: 900 });
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).toHaveCount(0);
	await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("context sheets change coverage at the same sm boundary as their animation", async ({
	page,
}) => {
	await page.setViewportSize({ width: 639, height: 900 });
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Everyday checking" });
	await expect(sheet).toBeVisible();
	for (const width of [639, 640, 767, 768, 1024]) {
		await page.setViewportSize({ width, height: 900 });
		await expect
			.poll(async () => (await sheet.boundingBox())!.width)
			.toBe(width < 640 ? width : Math.min(768, width - 48));
		await expectWithinViewport(sheet, page);
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
		const dialog = page.getByRole("dialog");
		await expectWithinViewport(dialog, page);
		await page.getByLabel("Account name").fill("Sizing regression");
		await page.getByLabel("Balance (USD)", { exact: true }).fill("2500");
		// Native submission must still reach the externally owned form.
		await page.getByLabel("Account name").press("Enter");
		await expect(dialog).not.toBeVisible();
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
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expectWithinViewport(bar, page);
		const main = await page.getByRole("main").boundingBox();
		const barBox = await bar.boundingBox();
		expect(main!.y + main!.height).toBeLessThanOrEqual(barBox!.y + 1);
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(page.getByText("Plan saved on the server.")).toBeVisible();
		await expect(bar).toHaveCount(0);
		await expectWithinViewport(
			page.getByText("Plan saved on the server.").locator(".."),
			page,
		);
	});
}
