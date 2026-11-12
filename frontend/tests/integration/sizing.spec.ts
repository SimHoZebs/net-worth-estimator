import { expect, type Locator, type Page, test } from "./base.ts";

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
	// The net worth chart sits below the safe card now, so hovering it
	// scrolls to the page bottom and leaves the wheel nowhere to go.
	// Return to the top so the wheel check proves the page scrolls.
	await page.evaluate(() => window.scrollTo(0, 0));
	const initialScroll = await page.evaluate(() => window.scrollY);
	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(initialScroll);
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page).toHaveURL(/\/accounts$/);
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

test("account detail controls remain usable across responsive resizes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const sheet = page.getByRole("region", { name: "Account details" });
	await expect(sheet).toBeVisible();
	for (const width of [320, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		const box = (await sheet.boundingBox())!;
		const viewport = page.viewportSize()!;
		// The detail is a scrollable page, not a viewport-height sheet, so
		// only horizontal containment applies here.
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
		await expect(sheet.getByLabel("Transaction source")).toBeVisible();
		await expect(
			page
				.getByRole("navigation", { name: "Breadcrumb" })
				.getByRole("button", { name: "Accounts" }),
		).toBeVisible();
	}
	await page
		.getByRole("navigation", { name: "Breadcrumb" })
		.getByRole("button", { name: "Accounts" })
		.click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(sheet).not.toBeVisible();
});

for (const width of [320, 390]) {
	test(`account transactions fit a ${width}px phone without horizontal scroll`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const longTitle =
			"A very long transaction title that exceeds the phone viewport and must truncate";
		const created = await page.request.post("/v1/transactions", {
			data: {
				name: longTitle,
				sourceAccountId: "checking",
				destinations: [],
				amount: { value: 123.45 },
				date: "2026-01-20",
				enabled: true,
			},
		});
		expect(created.ok()).toBe(true);
		await page.goto("/accounts");
		await page
			.getByRole("button", { name: "Open Everyday checking transactions" })
			.click();
		const sheet = page.getByRole("region", { name: "Account details" });
		await expect(sheet).toBeVisible();
		await sheet
			.getByRole("searchbox", { name: "Search account transactions" })
			.fill("very long transaction");
		await expect(
			sheet.getByRole("button", { name: new RegExp(longTitle.slice(0, 20)) }),
		).toBeVisible();
		const table = sheet.getByRole("region", {
			name: /Transactions involving this account/,
		});
		await expect(table).toBeVisible();
		await expect
			.poll(async () =>
				table.evaluate((element) => element.scrollWidth - element.clientWidth),
			)
			.toBeLessThanOrEqual(0);
		await expect
			.poll(
				async () =>
					await page.evaluate(
						() => document.documentElement.scrollWidth - innerWidth,
					),
			)
			.toBeLessThanOrEqual(0);
		const title = page.locator(`strong[title="${longTitle}"]`);
		await expect(title).toBeVisible();
		const titleBox = await title.boundingBox();
		expect(titleBox).not.toBeNull();
		expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(width + 1);
		const truncated = await title.evaluate((element) => ({
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
			textOverflow: getComputedStyle(element).textOverflow,
			whiteSpace: getComputedStyle(element).whiteSpace,
		}));
		expect(truncated.textOverflow).toBe("ellipsis");
		expect(truncated.whiteSpace).toBe("nowrap");
		expect(truncated.scrollWidth).toBeGreaterThan(truncated.clientWidth);
	});
}

test("account header stacks cleanly on a narrow phone", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const sheet = page.getByRole("region", { name: "Account details" });
	await expect(sheet).toBeVisible();
	// Tabs stay in one scrollable row instead of wrapping onto a second row.
	const tabs = sheet.getByRole("tab");
	await expect(tabs).toHaveCount(3);
	const tabRows = await tabs.evaluateAll(
		(elements) =>
			new Set(
				elements.map((element) =>
					Math.round(element.getBoundingClientRect().y),
				),
			).size,
	);
	expect(tabRows).toBe(1);
	// The balance drops below the account name on the left when there is
	// no room beside it.
	const header = await sheet.evaluate((section) => {
		const row = section.querySelector(":scope > div")!;
		return [...row.children].map((kid) => {
			const rect = (kid as HTMLElement).getBoundingClientRect();
			return { x: rect.x, y: rect.y };
		});
	});
	expect(header.length).toBeGreaterThanOrEqual(2);
	expect(header[1]!.y).toBeGreaterThan(header[0]!.y);
	expect(header[1]!.x).toBeLessThanOrEqual(header[0]!.x + 1);
	// The search takes the full row instead of a capped width.
	const search = sheet.getByRole("searchbox", {
		name: "Search account transactions",
	});
	await expect(search).toBeVisible();
	const searchBox = await search.evaluate((element) => {
		const input = element.getBoundingClientRect();
		const container = element.parentElement!.getBoundingClientRect();
		return { input: input.width, container: container.width };
	});
	expect(searchBox.input).toBeGreaterThan(searchBox.container - 40);
});

for (const width of [320, 390, 768, 1440]) {
	test(`transaction tables fit a ${width}px viewport without horizontal scroll`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const longTitle =
			"A very long transaction title that exceeds the phone viewport and must truncate";
		const created = await page.request.post("/v1/transactions", {
			data: {
				name: longTitle,
				sourceAccountId: "checking",
				destinations: [],
				amount: { value: 123.45 },
				date: "2026-01-20",
				enabled: true,
			},
		});
		expect(created.ok()).toBe(true);
		// The global list uses the same table: date, transaction, amount.
		await page.goto("/transactions");
		const globalTable = page.getByRole("region", {
			name: "Transactions with dates and amounts.",
		});
		await expect(globalTable).toBeVisible();
		await expect
			.poll(async () =>
				globalTable.evaluate(
					(element) => element.scrollWidth - element.clientWidth,
				),
			)
			.toBeLessThanOrEqual(0);
		// Account detail renders the activity table plus the separate
		// balance history table. Both hold only their own rows and both
		// must fit without scrolling the region.
		await page.goto("/accounts");
		await page
			.getByRole("button", { name: "Open Everyday checking transactions" })
			.click();
		const sheet = page.getByRole("region", { name: "Account details" });
		await expect(sheet).toBeVisible();
		for (const name of [
			/Transactions involving this account/,
			"Balance history",
		] as const) {
			const table = sheet.getByRole("region", { name });
			await expect(table).toBeVisible();
			await expect
				.poll(async () =>
					table.evaluate(
						(element) => element.scrollWidth - element.clientWidth,
					),
				)
				.toBeLessThanOrEqual(0);
		}
		await expect
			.poll(
				async () =>
					await page.evaluate(
						() => document.documentElement.scrollWidth - innerWidth,
					),
			)
			.toBeLessThanOrEqual(0);
		// The overlong title truncates with an ellipsis instead of forcing
		// the table wider.
		const title = page.locator(`strong[title="${longTitle}"]`).first();
		await expect(title).toBeVisible();
		const truncated = await title.evaluate((element) => ({
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
			textOverflow: getComputedStyle(element).textOverflow,
			whiteSpace: getComputedStyle(element).whiteSpace,
		}));
		expect(truncated.textOverflow).toBe("ellipsis");
		expect(truncated.whiteSpace).toBe("nowrap");
		expect(truncated.scrollWidth).toBeGreaterThan(truncated.clientWidth);
	});
}

for (const width of [320, 390, 768, 1440]) {
	test(`failed-save forms and notifications remain usable at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/accounts");
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
		await page.goto("/transactions?editor=transaction&id=invest");
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
