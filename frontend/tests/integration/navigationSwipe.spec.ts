import type { CDPSession } from "@playwright/test";
import { expect, test, type Page } from "./base.ts";

async function swipe(
	cdp: CDPSession,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [from],
	});
	for (let step = 1; step <= 12; step++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [
				{
					x: from.x + ((to.x - from.x) * step) / 12,
					y: from.y + ((to.y - from.y) * step) / 12,
				},
			],
		});
		// Allow Chromium to perform native scrolling between touch updates.
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
}

async function mobilePage(page: Page) {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/transactions");
	await expect(
		page.getByRole("button", { name: "Toggle Sidebar" }),
	).toBeVisible();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	return cdp;
}

test("rightward mobile swipe opens larger navigation and a link dismisses it", async ({
	page,
}) => {
	const cdp = await mobilePage(page);
	await swipe(cdp, { x: 90, y: 100 }, { x: 300, y: 105 });
	const sidebar = page.getByRole("dialog", { name: "Sidebar", exact: true });
	await expect(sidebar).toBeVisible();
	const accounts = sidebar.getByRole("link", { name: "Accounts", exact: true });
	const dimensions = await accounts.evaluate((element) => ({
		height: element.getBoundingClientRect().height,
		fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
		iconWidth: element.querySelector("svg")?.getBoundingClientRect().width,
	}));
	expect(dimensions.height).toBeGreaterThanOrEqual(44);
	expect(dimensions.fontSize).toBeGreaterThanOrEqual(16);
	expect(dimensions.iconWidth).toBeGreaterThanOrEqual(20);
	await accounts.click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(sidebar).toBeHidden();
	await page.getByRole("button", { name: "Toggle Sidebar" }).click();
	await expect(sidebar).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sidebar).toBeHidden();
});

test("native horizontal scrolling owns the entire swipe even when it reaches its edge", async ({
	page,
}) => {
	const cdp = await mobilePage(page);
	// A native scroll surface isolates browser gesture arbitration from any
	// particular financial page's responsive table layout.
	await page.locator("#main-content").evaluate((main) => {
		const scroller = document.createElement("div");
		scroller.id = "gesture-scroll-surface";
		scroller.style.cssText =
			"position:fixed;left:20px;right:20px;top:150px;height:120px;overflow-x:auto;overscroll-behavior-x:contain;background:var(--background);z-index:10";
		const content = document.createElement("div");
		content.style.cssText = "width:900px;height:100px";
		content.textContent = "Horizontal scroll surface";
		scroller.append(content);
		main.append(scroller);
		scroller.scrollLeft = 90;
	});
	await swipe(cdp, { x: 85, y: 210 }, { x: 320, y: 215 });
	const scroller = page.locator("#gesture-scroll-surface");
	await expect
		.poll(() => scroller.evaluate((element) => element.scrollLeft))
		.toBe(0);
	await expect(
		page.getByRole("dialog", { name: "Sidebar", exact: true }),
	).toBeHidden();
	// A fresh rightward swipe at the left edge has no content left to scroll.
	await swipe(cdp, { x: 85, y: 210 }, { x: 320, y: 215 });
	await expect(
		page.getByRole("dialog", { name: "Sidebar", exact: true }),
	).toBeVisible();
});

test("vertical mobile scrolling and desktop touch do not open navigation", async ({
	page,
}) => {
	const cdp = await mobilePage(page);
	await swipe(cdp, { x: 120, y: 400 }, { x: 150, y: 180 });
	await expect(
		page.getByRole("dialog", { name: "Sidebar", exact: true }),
	).toBeHidden();
	await page.setViewportSize({ width: 1440, height: 1080 });
	await swipe(cdp, { x: 500, y: 200 }, { x: 750, y: 205 });
	await expect(
		page.getByRole("dialog", { name: "Sidebar", exact: true }),
	).toBeHidden();
	await expect(
		page.getByRole("link", { name: "Accounts", exact: true }),
	).toBeVisible();
	const desktopTarget = await page
		.getByRole("link", { name: "Accounts", exact: true })
		.evaluate((element) => ({
			height: element.getBoundingClientRect().height,
			fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
		}));
	expect(desktopTarget.height).toBeGreaterThanOrEqual(44);
	expect(desktopTarget.fontSize).toBeGreaterThanOrEqual(16);
});

test("a swipe inside an open sheet never stacks navigation above it", async ({
	page,
}) => {
	const cdp = await mobilePage(page);
	await page
		.getByRole("button", { name: /^View / })
		.first()
		.click();
	const detail = page.getByRole("dialog");
	await expect(detail).toBeVisible();
	await swipe(cdp, { x: 90, y: 200 }, { x: 300, y: 205 });
	await expect(
		page.getByRole("dialog", { name: "Sidebar", exact: true }),
	).toBeHidden();
	await expect(detail).toBeVisible();
});
