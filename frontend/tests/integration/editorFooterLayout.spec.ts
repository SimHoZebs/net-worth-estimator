import { expect, test, type Locator, type Page } from "./base.ts";

// Observed regression: on narrow viewports the editor actions lived inside
// DialogContent's overflow-y-auto and scrolled below the fold. Editors are now
// full-screen mobile surfaces with a scrolling body and a fixed parent footer.
async function openEditor(page: Page, route: string, trigger: string | RegExp) {
	await page.goto(route);
	const button = page.getByRole("button", { name: trigger }).first();
	await expect(button).toBeVisible();
	await button.click();
	const dialog = page.locator(
		'[data-slot="dialog-content"][data-full-screen-mobile]',
	);
	await expect(dialog).toBeVisible();
	return dialog;
}

async function assertFooterLayout(
	page: Page,
	dialog: Locator,
	requireOverflow: boolean,
) {
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("viewport missing");
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x).toBe(0);
	expect(box!.y).toBe(0);
	expect(box!.width).toBe(viewport.width);
	expect(box!.height).toBe(viewport.height);

	const style = await dialog.evaluate((el) => {
		const computed = getComputedStyle(el);
		return {
			position: computed.position,
			display: computed.display,
			direction: computed.flexDirection,
			radius: computed.borderRadius,
			transform: computed.transform,
		};
	});
	expect(style).toMatchObject({
		position: "fixed",
		display: "flex",
		direction: "column",
		radius: "0px",
	});
	expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(style.transform);

	const body = dialog.locator('[data-slot="dialog-body"]');
	const footer = dialog.locator('[data-slot="dialog-footer"]');
	await expect(body).toHaveCount(1);
	await expect(footer).toHaveCount(1);
	const structure = await dialog.evaluate((el) => {
		const body = el.querySelector('[data-slot="dialog-body"]');
		const footer = el.querySelector('[data-slot="dialog-footer"]');
		return {
			footerInBody: Boolean(body?.contains(footer ?? null)),
			footerParent:
				footer?.parentElement?.getAttribute("data-slot") ??
				footer?.parentElement?.tagName.toLowerCase(),
			contentScroll: (el.scrollHeight ?? 0) - (el.clientHeight ?? 0),
			bodyScrollWidth: (body?.scrollWidth ?? 0) - (body?.clientWidth ?? 0),
		};
	});
	expect(structure.footerInBody).toBe(false);
	expect(["form", "dialog-content"]).toContain(structure.footerParent);
	expect(structure.contentScroll).toBeLessThanOrEqual(1);
	expect(structure.bodyScrollWidth).toBeLessThanOrEqual(1);

	const footerBox = await footer.boundingBox();
	expect(footerBox).not.toBeNull();
	expect(footerBox!.x).toBeGreaterThanOrEqual(0);
	expect(footerBox!.x + footerBox!.width).toBeLessThanOrEqual(
		viewport.width + 1,
	);
	expect(footerBox!.y).toBeGreaterThanOrEqual(0);
	expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(
		viewport.height + 1,
	);
	await expect(footer.getByRole("button", { name: "Cancel" })).toBeVisible();
	await expect(
		footer.getByRole("button", { name: /^(Add|Save)/ }),
	).toBeVisible();

	const closeBox = await dialog
		.getByRole("button", { name: "Close", exact: true })
		.boundingBox();
	expect(closeBox).not.toBeNull();
	expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(
		viewport.height + 1,
	);

	const overflow = await page.evaluate(() => ({
		document: document.documentElement.scrollWidth,
		viewport: window.innerWidth,
	}));
	expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);

	const scroll = await body.evaluate((el) => {
		const overflows = el.scrollHeight > el.clientHeight;
		const before = el.scrollTop;
		el.scrollTop = el.scrollHeight;
		return {
			overflows,
			before,
			after: el.scrollTop,
			overflowY: getComputedStyle(el).overflowY,
		};
	});
	expect(scroll.overflowY).toBe("auto");
	if (requireOverflow) {
		expect(scroll.overflows).toBe(true);
		expect(scroll.after).toBeGreaterThan(scroll.before);
	}
	const afterScroll = await footer.boundingBox();
	expect(afterScroll!.y).toBeCloseTo(footerBox!.y, 0);
}

async function openDebtEditor(page: Page) {
	const dialog = await openEditor(page, "/accounts", "Add account");
	const body = dialog.locator('[data-slot="dialog-body"]');
	await body.getByRole("combobox", { name: "Account type" }).click();
	await page.getByRole("option", { name: "Debt" }).click();
	await expect(body.getByText("Amount owed")).toBeVisible();
	return dialog;
}

test.describe("editor dialog mobile layout", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("add transaction fills the viewport with a fixed action footer", async ({
		page,
	}) => {
		await assertFooterLayout(
			page,
			await openEditor(page, "/transactions", "Add transaction"),
			false,
		);
	});

	test("debt account fills the viewport with a fixed action footer", async ({
		page,
	}) => {
		await assertFooterLayout(page, await openDebtEditor(page), false);
	});
});

test.describe("editor dialog very narrow layout", () => {
	test.use({ viewport: { width: 320, height: 700 } });

	test("add transaction scrolls only the body above the visible footer", async ({
		page,
	}) => {
		await assertFooterLayout(
			page,
			await openEditor(page, "/transactions", "Add transaction"),
			true,
		);
	});

	test("debt account scrolls only the body above the visible footer", async ({
		page,
	}) => {
		await assertFooterLayout(page, await openDebtEditor(page), true);
	});

	test("transaction footer still submits from outside the scroll region", async ({
		page,
	}) => {
		const dialog = await openEditor(page, "/transactions", "Add transaction");
		const body = dialog.locator('[data-slot="dialog-body"]');
		await body.getByLabel("Transaction name").fill("Footer layout charge");
		await body.getByLabel("Amount").fill("42");
		await body.getByRole("combobox", { name: "To" }).click();
		await page.getByRole("option", { name: "Everyday checking" }).click();
		const save = dialog.getByRole("button", { name: "Add transaction" });
		await expect(save).toBeEnabled();
		const saved = page.waitForResponse(
			(response) =>
				response.url().includes("/v1/transactions") &&
				response.request().method() === "POST",
		);
		await save.click();
		expect([200, 201]).toContain((await saved).status());
		await expect(dialog).toBeHidden();
	});

	test("clean Escape closes the full-screen editor and restores focus", async ({
		page,
	}) => {
		await page.goto("/transactions");
		const trigger = page
			.getByRole("button", { name: "Add transaction" })
			.first();
		await expect(trigger).toBeVisible();
		await trigger.click();
		const dialog = page.locator(
			'[data-slot="dialog-content"][data-full-screen-mobile]',
		);
		await expect(dialog).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("debt account cancel keeps the parent discard guard", async ({
		page,
	}) => {
		const dialog = await openDebtEditor(page);
		const cancel = dialog.getByRole("button", { name: "Cancel" });
		await cancel.click();
		const confirm = page.getByRole("alertdialog", {
			name: "Discard changes?",
		});
		await expect(confirm).toBeVisible();
		await confirm.getByRole("button", { name: "Continue editing" }).click();
		await expect(dialog).toBeVisible();
		await cancel.click();
		await confirm.getByRole("button", { name: "Discard changes" }).click();
		await expect(dialog).toBeHidden();
	});
});
