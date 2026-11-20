import { expect, request, test, type Page } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

// The right-side Configure sheet and the transaction detail sheet share one
// canonical shell: full width on mobile, xl on desktop, fixed header with a
// reserved close zone, scrollable SheetBody, optional footer. These tests lock
// that contract on the transaction sheet and prove Configure parity through
// the same safe-card workflow.
async function seedCardCharge(): Promise<void> {
	const api = await request.newContext();
	try {
		const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
		if (!read.ok()) throw new Error(`model read failed: ${read.status()}`);
		const { model } = (await read.json()) as {
			model: { transactions: unknown[] } & Record<string, unknown>;
		};
		const noon = new Date();
		noon.setHours(12, 0, 0, 0);
		const postedTime = Math.floor(noon.getTime() / 1000);
		const blank = {
			...model,
			transactions: [
				...model.transactions,
				{
					id: "01900000-0000-7000-8000-000000000099",
					name: "Sheet parity charge",
					sourceAccountId: "loan",
					destinations: [],
					amount: {
						resolver: "expression",
						config: { expression: "100" },
						inputs: {},
					},
					postedTime,
					transactionTime: postedTime,
					enabled: true,
				},
			],
		};
		const response = await api.post(`${FIXTURE_API}/v1/model/import`, {
			data: { model: blank },
		});
		if (!response.ok())
			throw new Error(
				`model import failed: ${response.status()} ${await response.text()}`,
			);
		const body = (await response.json()) as {
			saved: boolean;
			issues: unknown[];
		};
		expect(body.saved).toBe(true);
		expect(body.issues).toEqual([]);
	} finally {
		await api.dispose();
	}
}

async function openTransactionDetail(page: Page) {
	// Any transaction row opens the same detail shell; the transactions
	// page always lists the baseline rows.
	await page.goto("/transactions");
	const row = page.getByRole("button", { name: /^View / }).first();
	await row.click();
	const sheet = page.locator('[data-slot="sheet-content"]').first();
	await expect(sheet).toBeVisible();
	return { sheet, row };
}

test("transaction detail sheet uses the canonical right-side shell", async ({
	page,
}) => {
	const { sheet, row } = await openTransactionDetail(page);
	const header = sheet.locator(':scope > [data-slot="sheet-header"]');
	const body = sheet.locator(':scope > [data-slot="sheet-body"]');
	await expect(header).toHaveCount(1);
	await expect(body).toHaveCount(1);
	const title = sheet.locator(':scope [data-slot="sheet-title"]');
	const close = sheet.getByRole("button", { name: "Close", exact: true });
	// Desktop width is capped at xl while the viewport is wider.
	const box = await sheet.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.width).toBe(576);
	// The body owns scrolling; the header keeps the close zone clear.
	const bodyStyle = await body.evaluate((el) => {
		const computed = getComputedStyle(el);
		return {
			overflowY: computed.overflowY,
			flexGrow: computed.flexGrow,
		};
	});
	expect(bodyStyle.overflowY).toBe("auto");
	expect(bodyStyle.flexGrow).toBe("1");
	const titleBox = await title.boundingBox();
	const closeBox = await close.boundingBox();
	expect(titleBox).not.toBeNull();
	expect(closeBox).not.toBeNull();
	expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(closeBox!.x + 1);
	// The page itself does not gain a horizontal scrollbar.
	const overflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
	}));
	expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
	// Clean Escape closes the sheet and returns focus to the row.
	await page.keyboard.press("Escape");
	await expect(sheet).not.toBeVisible();
	await expect(row).toBeFocused();
});

test("nested sharing sheet shares the canonical shell with Escape stack", async ({
	page,
}) => {
	const { sheet } = await openTransactionDetail(page);
	const sharing = sheet.getByRole("button", {
		name: /Open sharing settings/,
	});
	await sharing.click();
	const nested = page.locator('[data-slot="sheet-content"]', {
		has: page.locator('[data-slot="sheet-title"]', { hasText: "Sharing" }),
	});
	await expect(nested).toBeVisible();
	// Same geometry as the parent sheet, not a narrower copy.
	const parentBox = await sheet.boundingBox();
	const nestedBox = await nested.boundingBox();
	expect(parentBox).not.toBeNull();
	expect(nestedBox).not.toBeNull();
	expect(nestedBox!.width).toBe(576);
	expect(nestedBox!.width).toBe(parentBox!.width);
	// Escape closes only the nested sheet; the parent stays open and focus
	// returns to the sharing button.
	await page.keyboard.press("Escape");
	await expect(nested).toHaveCount(0);
	await expect(sheet).toBeVisible();
	await expect(sharing).toBeFocused();
});

test("transaction detail sheet keeps the dirty-close guard", async ({
	page,
}) => {
	const { sheet } = await openTransactionDetail(page);
	await sheet
		.getByLabel(/^(Transaction|Schedule) name$/)
		.fill("Home renovation edited");
	await page.keyboard.press("Escape");
	const confirm = page.getByRole("alertdialog", {
		name: "Discard unsaved changes?",
	});
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Discard changes" }).click();
	await expect(sheet).not.toBeVisible();
});

test("safe spending and transaction sheets share the canonical shell", async ({
	page,
}) => {
	// Exercise scrolling independently of how many Configure fields exist.
	await page.setViewportSize({ width: 1280, height: 480 });
	await seedCardCharge();
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(card.locator('[aria-busy="true"]')).toHaveCount(0);
	// Configure opens from the same card whose transactions open the detail.
	await card.getByRole("button", { name: "Configure", exact: true }).click();
	const configure = page.locator('[data-slot="sheet-content"]').first();
	await expect(configure).toBeVisible();
	const configureBox = await configure.boundingBox();
	expect(configureBox).not.toBeNull();
	expect(configureBox!.width).toBe(576);
	const configureHeader = configure.locator(
		':scope > [data-slot="sheet-header"]',
	);
	const configureBody = configure.locator(':scope > [data-slot="sheet-body"]');
	await expect(configureHeader).toHaveCount(1);
	await expect(configureBody).toHaveCount(1);
	// In a short viewport the body scrolls while the fixed header stays put.
	const scrolled = await configureBody.evaluate((el) => {
		const overflows = el.scrollHeight > el.clientHeight;
		if (overflows) el.scrollTop = el.scrollHeight;
		return { overflows, top: el.scrollTop };
	});
	expect(scrolled.overflows).toBe(true);
	expect(scrolled.top).toBeGreaterThan(0);
	const headerBox = await configureHeader.boundingBox();
	await configureBody.evaluate((el) => {
		el.scrollTop = 0;
	});
	const resetBox = await configureHeader.boundingBox();
	expect(resetBox?.y).toBe(headerBox?.y);
	const configureTitle = configure.locator(':scope [data-slot="sheet-title"]');
	const configureClose = configure.getByRole("button", {
		name: "Close",
		exact: true,
	});
	const configureTitleBox = await configureTitle.boundingBox();
	const configureCloseBox = await configureClose.boundingBox();
	expect(configureTitleBox!.x + configureTitleBox!.width).toBeLessThanOrEqual(
		configureCloseBox!.x + 1,
	);
	await page.keyboard.press("Escape");
	await expect(configure).not.toBeVisible();
	// The one-line protected summary opens the ledger drawer from the same
	// card: same bounding width, same slot policy, same close placement.
	await card.getByRole("button", { name: /Details ·/ }).click();
	const ledger = page.locator('[data-slot="sheet-content"]').first();
	await expect(ledger).toBeVisible();
	await expect(
		ledger.getByRole("region", { name: "Details" }),
	).toBeVisible();
	await expect(
		ledger.getByRole("region", { name: "Cash checks" }),
	).toBeVisible();
	await expect(
		ledger.getByRole("region", { name: "Cash evidence" }),
	).toBeVisible();
	const ledgerBox = await ledger.boundingBox();
	expect(ledgerBox).not.toBeNull();
	expect(ledgerBox!.width).toBe(configureBox!.width);
	const ledgerHeader = ledger.locator(':scope > [data-slot="sheet-header"]');
	const ledgerBody = ledger.locator(':scope > [data-slot="sheet-body"]');
	await expect(ledgerHeader).toHaveCount(1);
	await expect(ledgerBody).toHaveCount(1);
	const ledgerTitle = ledger.locator(':scope [data-slot="sheet-title"]');
	const ledgerClose = ledger.getByRole("button", {
		name: "Close",
		exact: true,
	});
	const ledgerTitleBox = await ledgerTitle.boundingBox();
	const ledgerCloseBox = await ledgerClose.boundingBox();
	expect(ledgerTitleBox!.x + ledgerTitleBox!.width).toBeLessThanOrEqual(
		ledgerCloseBox!.x + 1,
	);
	await page.keyboard.press("Escape");
	await expect(ledger).not.toBeVisible();
	// A transaction detail opened from its own page uses the same shell.
	const { sheet: detail } = await openTransactionDetail(page);
	const detailBox = await detail.boundingBox();
	expect(detailBox).not.toBeNull();
	expect(detailBox!.width).toBe(configureBox!.width);
	const detailHeader = detail.locator(':scope > [data-slot="sheet-header"]');
	const detailBody = detail.locator(':scope > [data-slot="sheet-body"]');
	await expect(detailHeader).toHaveCount(1);
	await expect(detailBody).toHaveCount(1);
	const detailTitle = detail.locator(':scope [data-slot="sheet-title"]');
	const detailClose = detail.getByRole("button", {
		name: "Close",
		exact: true,
	});
	const detailTitleBox = await detailTitle.boundingBox();
	const detailCloseBox = await detailClose.boundingBox();
	expect(detailTitleBox!.x + detailTitleBox!.width).toBeLessThanOrEqual(
		detailCloseBox!.x + 1,
	);
});

test.describe("side sheet narrow layout", () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test("transaction detail sheet fills the mobile viewport", async ({
		page,
	}) => {
		const { sheet } = await openTransactionDetail(page);
		const box = await sheet.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBe(390);
		const title = sheet.locator(':scope [data-slot="sheet-title"]');
		await expect(title).toBeVisible();
		const close = sheet.getByRole("button", {
			name: "Close",
			exact: true,
		});
		const titleBox = await title.boundingBox();
		const closeBox = await close.boundingBox();
		expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(closeBox!.x + 1);
	});
	test("configure sheet fills the mobile viewport", async ({ page }) => {
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.locator('[aria-busy="true"]')).toHaveCount(0);
		await card.getByRole("button", { name: "Configure", exact: true }).click();
		const sheet = page.locator('[data-slot="sheet-content"]').first();
		await expect(sheet).toBeVisible();
		const box = await sheet.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBe(390);
	});
});

test.describe("side sheet very narrow layout", () => {
	test.use({ viewport: { width: 320, height: 700 } });
	test("configure sheet fills the small viewport", async ({ page }) => {
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.locator('[aria-busy="true"]')).toHaveCount(0);
		await card.getByRole("button", { name: "Configure", exact: true }).click();
		const sheet = page.locator('[data-slot="sheet-content"]').first();
		await expect(sheet).toBeVisible();
		const box = await sheet.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBe(320);
	});
});

test.describe("side sheet dark theme", () => {
	test.use({ colorScheme: "dark" });
	test("transaction detail sheet keeps the canonical shell", async ({
		page,
	}) => {
		const { sheet } = await openTransactionDetail(page);
		const box = await sheet.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBe(576);
		const title = sheet.locator(':scope [data-slot="sheet-title"]');
		await expect(title).toBeVisible();
		const family = await title.evaluate(
			(el) => getComputedStyle(el).fontFamily,
		);
		expect(family).toMatch(/Merriweather/);
	});
});
