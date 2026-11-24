import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./base.ts";
import { seedSharingFixture } from "./fixture.ts";

function workspaceHeader(page: Page) {
	return page.locator('[data-slot="sidebar-inset"] > header');
}

function sidebarTrigger(page: Page) {
	return page.locator('[data-slot="sidebar-trigger"]');
}

function breadcrumbs(page: Page) {
	return page.getByRole("navigation", { name: "Breadcrumb", exact: true });
}

async function mainGeometry(page: Page) {
	return page.locator("#main-content").evaluate((main) => {
		const box = main.getBoundingClientRect();
		const style = getComputedStyle(main);
		return {
			top: box.top,
			left: box.left,
			paddingTop: Number.parseFloat(style.paddingTop),
			paddingLeft: Number.parseFloat(style.paddingLeft),
		};
	});
}

async function expectDesktopContentStart(page: Page) {
	const main = page.locator("#main-content");
	const section = main.locator(":scope > section");
	await expect(section).toBeVisible();
	const geometry = await mainGeometry(page);
	const mainBox = await main.boundingBox();
	const sectionBox = await section.boundingBox();
	expect(mainBox).not.toBeNull();
	expect(sectionBox).not.toBeNull();
	expect(geometry.paddingTop).toBe(32);
	expect(sectionBox!.y - mainBox!.y).toBeCloseTo(geometry.paddingTop, 0);
}

async function expectDesktopDetailBreadcrumb(
	page: Page,
	parentLabel: string,
	currentLabel: string,
) {
	await expect(workspaceHeader(page)).toHaveCount(0);
	await expect(sidebarTrigger(page)).toHaveCount(0);
	const breadcrumb = breadcrumbs(page);
	await expect(breadcrumb).toHaveCount(1);
	await expect(breadcrumb).toBeVisible();
	await expect(
		page.locator("#main-content").getByRole("navigation", {
			name: "Breadcrumb",
			exact: true,
		}),
	).toHaveCount(1);
	await expect(
		breadcrumb.getByRole("link", { name: parentLabel, exact: true }),
	).toBeVisible();
	await expect(breadcrumb.locator('li[aria-current="page"]')).toHaveText(
		currentLabel,
	);

	const main = page.locator("#main-content");
	const section = main.locator(":scope > section");
	const geometry = await mainGeometry(page);
	const mainBox = await main.boundingBox();
	const breadcrumbBox = await breadcrumb.boundingBox();
	const sectionBox = await section.boundingBox();
	expect(mainBox).not.toBeNull();
	expect(breadcrumbBox).not.toBeNull();
	expect(sectionBox).not.toBeNull();
	expect(geometry.paddingTop).toBe(32);
	expect(breadcrumbBox!.y - mainBox!.y).toBeCloseTo(geometry.paddingTop, 0);
	expect(breadcrumbBox!.x - mainBox!.x).toBeCloseTo(geometry.paddingLeft, 0);
	expect(sectionBox!.x).toBeCloseTo(breadcrumbBox!.x, 0);
	expect(breadcrumbBox!.height).toBeLessThanOrEqual(24);
	expect(
		sectionBox!.y - (breadcrumbBox!.y + breadcrumbBox!.height),
	).toBeCloseTo(8, 0);

	const surface = await breadcrumb.evaluate((element) => {
		const style = getComputedStyle(element.parentElement!);
		return {
			backgroundColor: style.backgroundColor,
			borderTopWidth: style.borderTopWidth,
			borderBottomWidth: style.borderBottomWidth,
		};
	});
	expect(surface).toEqual({
		backgroundColor: "rgba(0, 0, 0, 0)",
		borderTopWidth: "0px",
		borderBottomWidth: "0px",
	});
	await expect(page).toHaveTitle(`${parentLabel} · Waypoint`);
}

async function expectMobileHeader(
	page: Page,
	parentLabel: string,
	currentLabel: string,
) {
	const header = workspaceHeader(page);
	await expect(header).toBeVisible();
	const headerBox = await header.boundingBox();
	expect(headerBox).not.toBeNull();
	expect(headerBox!.height).toBe(64);
	await expect(sidebarTrigger(page)).toBeVisible();
	const breadcrumb = breadcrumbs(page);
	await expect(breadcrumb).toHaveCount(1);
	await expect(breadcrumb).toBeVisible();
	await expect(
		header.getByRole("navigation", { name: "Breadcrumb" }),
	).toHaveCount(1);
	await expect(
		page.locator("#main-content").getByRole("navigation", {
			name: "Breadcrumb",
			exact: true,
		}),
	).toHaveCount(0);
	await expect(breadcrumb.locator('li[aria-current="page"]')).toHaveText(
		currentLabel,
	);

	const main = page.locator("#main-content");
	const section = main.locator(":scope > section");
	const geometry = await mainGeometry(page);
	const sectionBox = await section.boundingBox();
	expect(sectionBox).not.toBeNull();
	expect(geometry.paddingTop).toBe(24);
	expect(sectionBox!.y - headerBox!.y).toBeCloseTo(
		headerBox!.height + geometry.paddingTop,
		0,
	);
	await expect(page).toHaveTitle(`${parentLabel} · Waypoint`);
}

async function openAccountDetail(page: Page) {
	await page.goto("/accounts/checking");
	await expect(
		page.getByRole("region", { name: "Account details" }),
	).toBeVisible();
	const currentLabel = await page.getByLabel("Account name").inputValue();
	return { parentLabel: "Accounts", currentLabel };
}

async function openGroupDetail(page: Page) {
	const groupName = `Workspace header ${randomUUID()}`;
	const { groupId } = await seedSharingFixture(
		groupName,
		"Header fixture owner",
		[{ name: "Shared coffee", amount: "4.50" }],
	);
	await page.goto(`/groups/${groupId}`);
	await expect(
		page.getByRole("heading", { name: groupName, exact: true }),
	).toBeVisible();
	return { parentLabel: "Groups", currentLabel: groupName };
}

const detailRoutes = [
	{ name: "account", open: openAccountDetail },
	{ name: "group", open: openGroupDetail },
];

test("desktop non-detail content starts at the existing padding without a workspace header", async ({
	page,
}) => {
	await page.goto("/accounts");
	await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
	await expect(workspaceHeader(page)).toHaveCount(0);
	await expect(sidebarTrigger(page)).toHaveCount(0);
	await expect(breadcrumbs(page)).toHaveCount(0);
	await expectDesktopContentStart(page);
	await expect(
		page.getByRole("heading", { name: "Accounts and starting balances" }),
	).toBeAttached();
	await expect(page).toHaveTitle("Accounts · Waypoint");
});

for (const route of detailRoutes) {
	test(`desktop ${route.name} detail keeps one compact breadcrumb inside main content`, async ({
		page,
	}) => {
		const { parentLabel, currentLabel } = await route.open(page);
		await expectDesktopDetailBreadcrumb(page, parentLabel, currentLabel);
	});

	test(`mobile ${route.name} detail keeps the 64px workspace header and breadcrumb`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const { parentLabel, currentLabel } = await route.open(page);
		await expectMobileHeader(page, parentLabel, currentLabel);
	});

	test(`${route.name} detail keeps one breadcrumb through breakpoint resize round trips`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const { parentLabel, currentLabel } = await route.open(page);
		await expectMobileHeader(page, parentLabel, currentLabel);

		await page.setViewportSize({ width: 1440, height: 1080 });
		await expectDesktopDetailBreadcrumb(page, parentLabel, currentLabel);

		await page.setViewportSize({ width: 767, height: 844 });
		await expectMobileHeader(page, parentLabel, currentLabel);

		await page.setViewportSize({ width: 768, height: 844 });
		await expectDesktopDetailBreadcrumb(page, parentLabel, currentLabel);

		await page.setViewportSize({ width: 390, height: 844 });
		await expectMobileHeader(page, parentLabel, currentLabel);
	});
}

test("mobile non-detail keeps the 64px workspace header and page breadcrumb", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/accounts");
	await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
	await expectMobileHeader(page, "Accounts", "Accounts");
});

test("desktop detail breadcrumbs stay out of print output", async ({
	page,
}) => {
	const { parentLabel, currentLabel } = await openAccountDetail(page);
	await expectDesktopDetailBreadcrumb(page, parentLabel, currentLabel);
	await page.emulateMedia({ media: "print" });
	await expect(breadcrumbs(page)).toBeHidden();
	await page.emulateMedia({ media: "screen" });
	await expect(breadcrumbs(page)).toBeVisible();
});
