import { expect, test, type Locator, type Page } from "./base.ts";
import { seedInboxFixture } from "./fixture.ts";

const NAV_LABELS = [
	"Outlook",
	"Accounts",
	"Transactions",
	"Money flows",
	"Planned purchases",
	"Evaluations",
	"Groups",
	"Inbox",
	"Configs",
] as const;

function desktopSidebar(page: Page) {
	return page.locator('[data-slot="sidebar-container"]');
}

function sidebarHeader(sidebar: Locator) {
	return sidebar.locator('[data-slot="sidebar-header"]');
}

async function expectToggleWithinSidebar(sidebar: Locator, toggle: Locator) {
	await expect
		.poll(() =>
			toggle.evaluate((element) => {
				const container = element.closest('[data-slot="sidebar-container"]');
				if (!container) return false;
				const toggleBounds = element.getBoundingClientRect();
				const sidebarBounds = container.getBoundingClientRect();
				return (
					toggleBounds.left >= sidebarBounds.left &&
					toggleBounds.right <= sidebarBounds.right
				);
			}),
		)
		.toBe(true);
}

async function expectMainContentClickThrough(page: Page, toggle: Locator) {
	const inset = page.locator('[data-slot="sidebar-inset"]');
	const position = await toggle.evaluate((element) => {
		const container = element.closest('[data-slot="sidebar-wrapper"]');
		const main = container?.querySelector('[data-slot="sidebar-inset"]');
		if (!main) return null;
		const toggleBounds = element.getBoundingClientRect();
		const mainBounds = main.getBoundingClientRect();
		return {
			x: 1,
			y: toggleBounds.top - mainBounds.top + toggleBounds.height / 2,
		};
	});
	if (!position) throw new Error("Sidebar main region was not found.");
	await inset.click({ position });
}

async function expectNoHorizontalOverflow(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			),
		)
		.toBeLessThanOrEqual(0);
}

async function expectDesktopGeometry(page: Page, width: 256 | 48) {
	const sidebar = desktopSidebar(page);
	const gap = page.locator('[data-slot="sidebar-gap"]');
	await expect(sidebar).toHaveCSS("width", `${width}px`);
	await expect(gap).toHaveCSS("width", `${width}px`);
	await expect
		.poll(
			async () =>
				(await page.locator('[data-slot="sidebar-inset"]').boundingBox())?.x ??
				-1,
		)
		.toBeCloseTo(width, 0);
	await expectNoHorizontalOverflow(page);
}

async function expectIconNavigation(sidebar: Locator, inboxName = "Inbox") {
	for (const name of NAV_LABELS) {
		const link = sidebar.getByRole("link", {
			name: name === "Inbox" ? inboxName : name,
			exact: true,
		});
		await expect(link).toBeVisible();
		await expect(link.locator("svg").first()).toBeVisible();
	}
}

type NavigationGeometry = {
	width: number;
	height: number;
	top: number;
	padding: string;
	iconWidth: number;
	iconHeight: number;
	iconOffsetX: number;
	iconOffsetY: number;
};

async function readNavigationGeometry(
	sidebar: Locator,
	inboxName = "Inbox",
): Promise<NavigationGeometry[]> {
	return Promise.all(
		NAV_LABELS.map(async (name) => {
			const link = sidebar.getByRole("link", {
				name: name === "Inbox" ? inboxName : name,
				exact: true,
			});
			return link.evaluate((element) => {
				const button = element.getBoundingClientRect();
				const icon = element.querySelector("svg")?.getBoundingClientRect();
				return {
					width: button.width,
					height: button.height,
					top: button.top,
					padding: getComputedStyle(element).padding,
					iconWidth: icon?.width ?? -1,
					iconHeight: icon?.height ?? -1,
					iconOffsetX: icon ? icon.left - button.left : -1,
					iconOffsetY: icon ? icon.top - button.top : -1,
				};
			});
		}),
	);
}

function navigationRowGaps(geometry: NavigationGeometry[]) {
	const mainNavigation = geometry.slice(0, -1);
	return mainNavigation
		.slice(1)
		.map((row, index) => row.top - mainNavigation[index].top);
}

function expectNavigationGeometryPreserved(
	expanded: NavigationGeometry[],
	collapsed: NavigationGeometry[],
) {
	expect(expanded).toHaveLength(NAV_LABELS.length);
	expect(collapsed).toHaveLength(NAV_LABELS.length);
	expect(collapsed[0]?.top).toBe(expanded[0]?.top);
	expect(navigationRowGaps(collapsed)).toEqual(navigationRowGaps(expanded));

	for (const [index, row] of collapsed.entries()) {
		const expandedRow = expanded[index];
		expect(expandedRow).toBeDefined();
		if (!expandedRow) continue;
		expect(row.width).toBeGreaterThanOrEqual(47);
		expect(row.width).toBeLessThanOrEqual(48);
		expect(row.height).toBe(48);
		expect(row.height).toBe(expandedRow.height);
		expect(row.padding).toBe("8px");
		expect(row.iconWidth).toBe(20);
		expect(row.iconHeight).toBe(20);
		expect(row.iconWidth).toBe(expandedRow.iconWidth);
		expect(row.iconHeight).toBe(expandedRow.iconHeight);
		expect(row.iconOffsetX + row.iconWidth / 2).toBeCloseTo(row.width / 2, 1);
		expect(row.iconOffsetY).toBe(14);
	}
}

async function expectSidebarLabelVisibility(
	sidebar: Locator,
	visible: boolean,
) {
	const brandLink = sidebar.getByRole("link", {
		name: "Waypoint home",
		exact: true,
		includeHidden: true,
	});
	const wordmark = brandLink
		.locator("span")
		.filter({ hasText: /^waypoint\.$/ });
	const themeButton = sidebar.getByRole("button", { name: /^Theme: / });
	const themeLabel = themeButton
		.locator("span")
		.filter({ hasText: /^Theme: / });
	const syncStatus = sidebar
		.locator(
			'[data-slot="sidebar-footer"] time, [data-slot="sidebar-footer"] span',
		)
		.filter({
			hasText:
				/^(Last synced |Never synced$|Sync not configured$|Sync status unavailable$|Sync time unavailable$)/,
		})
		.last();
	const labels = [
		wordmark,
		...NAV_LABELS.map((name) => sidebar.getByText(name, { exact: true })),
		themeLabel,
		syncStatus,
	];

	if (visible) await expect(brandLink).toBeVisible();
	else await expect(brandLink).toBeHidden();

	for (const label of labels) {
		if (visible) await expect(label).toBeVisible();
		else await expect(label).toBeHidden();
	}
	await expect(themeButton).toHaveAccessibleName(
		/^Theme: (System|Light|Dark)$/,
	);
}

test("desktop navigation collapses to accessible icons and expands again", async ({
	page,
}) => {
	await seedInboxFixture([{ name: "Sidebar unread share", amount: "42.00" }]);
	await page.goto("/transactions");
	const sidebar = desktopSidebar(page);
	const header = sidebarHeader(sidebar);
	const closeNavigation = header.getByRole("button", {
		name: "Close navigation",
		exact: true,
	});

	await expect(closeNavigation).toBeVisible();
	await expect(closeNavigation).toHaveCSS("width", "32px");
	await expect(closeNavigation).toHaveCSS("height", "32px");
	await expectToggleWithinSidebar(sidebar, closeNavigation);
	await expect(sidebar.locator('[data-slot="sidebar-rail"]')).toHaveCount(0);
	await expectDesktopGeometry(page, 256);
	await expectMainContentClickThrough(page, closeNavigation);
	await expectSidebarLabelVisibility(sidebar, true);
	await expectIconNavigation(sidebar, "Inbox, 1 unread");
	const inboxLink = sidebar.getByRole("link", {
		name: "Inbox, 1 unread",
		exact: true,
	});
	await expect(inboxLink).toHaveAccessibleName("Inbox, 1 unread");
	await expect(inboxLink.getByText("Inbox", { exact: true })).toBeVisible();
	const expandedNavigation = await readNavigationGeometry(
		sidebar,
		"Inbox, 1 unread",
	);

	await closeNavigation.click();
	await expectDesktopGeometry(page, 48);
	await expect(closeNavigation).toHaveCount(0);
	const openNavigation = header.getByRole("button", {
		name: "Open navigation",
		exact: true,
	});
	await expect(openNavigation).toBeVisible();
	await expect(openNavigation).toHaveCSS("width", "32px");
	await expect(openNavigation).toHaveCSS("height", "32px");
	await expectToggleWithinSidebar(sidebar, openNavigation);
	await expectMainContentClickThrough(page, openNavigation);
	await expectSidebarLabelVisibility(sidebar, false);
	await expectIconNavigation(sidebar, "Inbox, 1 unread");
	await expect(inboxLink).toHaveAccessibleName("Inbox, 1 unread");
	await expect(inboxLink.getByText("Inbox", { exact: true })).toBeHidden();
	const collapsedNavigation = await readNavigationGeometry(
		sidebar,
		"Inbox, 1 unread",
	);
	expectNavigationGeometryPreserved(expandedNavigation, collapsedNavigation);

	const accounts = sidebar.getByRole("link", {
		name: "Accounts",
		exact: true,
	});
	await openNavigation.focus();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	await expect(accounts).toBeFocused();
	await expect(
		page.getByRole("tooltip", { name: "Accounts", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Shift+Tab");
	await expect(openNavigation).toBeFocused();
	await expect(
		page.getByRole("tooltip", { name: "Open navigation", exact: true }),
	).toBeVisible();
	await inboxLink.hover();
	await expect(
		page.getByRole("tooltip", { name: "Inbox, 1 unread", exact: true }),
	).toBeVisible();

	await openNavigation.click();
	await expectDesktopGeometry(page, 256);
	await expect(openNavigation).toHaveCount(0);
	await expect(closeNavigation).toBeVisible();
	await expectSidebarLabelVisibility(sidebar, true);
});

test("Ctrl/Cmd+B performs the desktop collapse and expand cycle", async ({
	page,
}) => {
	await page.goto("/transactions");
	const sidebar = desktopSidebar(page);
	const header = sidebarHeader(sidebar);

	await expectDesktopGeometry(page, 256);
	await page.keyboard.press("ControlOrMeta+b");
	await expectDesktopGeometry(page, 48);
	await expect(
		header.getByRole("button", { name: "Open navigation", exact: true }),
	).toBeVisible();
	await expectSidebarLabelVisibility(sidebar, false);

	await page.keyboard.press("ControlOrMeta+b");
	await expectDesktopGeometry(page, 256);
	await expect(
		header.getByRole("button", { name: "Close navigation", exact: true }),
	).toBeVisible();
	await expectSidebarLabelVisibility(sidebar, true);
});

test("mobile navigation stays fully labeled after a desktop collapse and closes in-sheet", async ({
	page,
}) => {
	await page.goto("/transactions");
	await desktopSidebar(page)
		.getByRole("button", { name: "Close navigation", exact: true })
		.click();
	await expectDesktopGeometry(page, 48);

	await page.setViewportSize({ width: 390, height: 844 });
	await expectNoHorizontalOverflow(page);
	await page
		.getByRole("button", { name: "Toggle Sidebar", exact: true })
		.click();
	const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
	await expect(sheet).toBeVisible();
	await expectSidebarLabelVisibility(sheet, true);
	await expectIconNavigation(sheet);
	await expectNoHorizontalOverflow(page);

	await sheet
		.getByRole("button", { name: "Close navigation", exact: true })
		.click();
	await expect(sheet).toBeHidden();
	await expectNoHorizontalOverflow(page);
});
