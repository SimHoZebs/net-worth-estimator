import {
	expect,
	request,
	test,
	type APIRequestContext,
	type Locator,
	type Page,
} from "./base.ts";
import { FIXTURE_API, readSavedServerModel } from "./fixture.ts";

// The right-side Configure sheet and the transaction detail sheet share one
// canonical shell: full width on mobile, xl on desktop, fixed header with a
// reserved action zone, fixed tabs, and scrollable tab content. These tests lock
// that contract on the transaction sheet and prove Configure parity through
// the same safe-card workflow.
async function appendModelRows(
	key: "transactions" | "schedules",
	rows: Record<string, unknown>[],
): Promise<void> {
	const api = await request.newContext();
	try {
		const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
		if (!read.ok()) throw new Error(`model read failed: ${read.status()}`);
		const { model } = (await read.json()) as {
			model: Record<string, unknown[]> & Record<string, unknown>;
		};
		const response = await api.post(`${FIXTURE_API}/v1/model/import`, {
			data: { model: { ...model, [key]: [...(model[key] ?? []), ...rows] } },
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

function appendModelTransactions(transactions: Record<string, unknown>[]) {
	return appendModelRows("transactions", transactions);
}

function appendModelSchedules(schedules: Record<string, unknown>[]) {
	return appendModelRows("schedules", schedules);
}

async function seedCardCharge(): Promise<void> {
	const noon = new Date();
	noon.setHours(12, 0, 0, 0);
	const postedTime = Math.floor(noon.getTime() / 1000);
	await appendModelTransactions([
		{
			id: "01900000-0000-7000-8000-000000000099",
			name: "Sheet parity charge",
			sourceAccountId: "checking",
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
	]);
}

const READ_ONLY_STATEMENT_CARD_ID = "padding-statements-card";

async function seedReadOnlyStatement(api: APIRequestContext): Promise<void> {
	const closeInstant = Math.floor(Date.parse("2026-01-31T23:59:59Z") / 1000);
	const card = await api.post(`${FIXTURE_API}/v1/accounts`, {
		data: {
			id: READ_ONLY_STATEMENT_CARD_ID,
			name: "Padding statements card",
			kind: "credit_card",
			enabled: true,
			statementClosingDay: 31,
			balance: -125.55,
			observedAt: closeInstant,
		},
	});
	expect(card.ok(), await card.text()).toBe(true);
	const terms = await api.post(`${FIXTURE_API}/v1/payment-terms`, {
		data: {
			accountId: READ_ONLY_STATEMENT_CARD_ID,
			minimumFixed: 25,
			dueDay: 20,
		},
	});
	expect(terms.ok(), await terms.text()).toBe(true);
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

async function openNamedTransactionDetail(page: Page, name: string) {
	await page.goto("/transactions");
	const row = page.getByRole("button", {
		name: new RegExp(`^View ${name} `),
	});
	await expect(row).toBeVisible();
	await row.click();
	const sheet = page.locator('[data-slot="sheet-content"]').first();
	await expect(sheet).toBeVisible();
	return sheet;
}

function expectNoPostedBadge(sheet: Locator): Promise<void> {
	return expect(
		sheet.locator('[data-slot="badge"]').filter({ hasText: /^Posted$/ }),
	).toHaveCount(0);
}

// The header exposes exactly one visible, editable Name field. The dialog's
// semantic title is deliberately hidden and stable, so only this input may be
// used to measure header geometry.
function detailNameInput(sheet: Locator): Locator {
	return sheet.getByRole("textbox", { name: "Name", exact: true });
}

// The header owns one row: Name yields to the actions, with More options
// before Close. Every control shares a centre, and Close sits in the header's
// normal 16px right padding rather than an absolutely positioned top strip.
async function expectHeaderRowAligned(
	sheet: Locator,
	includeMoreOptions: boolean,
): Promise<void> {
	const name = detailNameInput(sheet);
	const close = sheet.getByRole("button", { name: "Close", exact: true });
	await expect(name).toBeVisible();
	await expect(close).toBeVisible();
	const controls: Locator[] = [name];
	if (includeMoreOptions) {
		const more = sheet.getByRole("button", { name: "More options" });
		await expect(more).toBeVisible();
		controls.push(more);
	}
	controls.push(close);
	const boxes = await Promise.all(
		controls.map((control) => control.boundingBox()),
	);
	expect(boxes.every(Boolean)).toBe(true);
	const centres = boxes.map((box) => box!.y + box!.height / 2);
	expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
	for (let index = 1; index < boxes.length; index += 1) {
		expect(boxes[index - 1]!.x + boxes[index - 1]!.width).toBeLessThanOrEqual(
			boxes[index]!.x + 1,
		);
	}
	const sheetBox = await sheet.boundingBox();
	expect(sheetBox).not.toBeNull();
	const closeRight =
		boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.width;
	expect(sheetBox!.x + sheetBox!.width - closeRight).toBeGreaterThanOrEqual(14);
	expect(sheetBox!.x + sheetBox!.width - closeRight).toBeLessThanOrEqual(18);
}

async function expectHiddenDetailTitle(
	sheet: Locator,
	expected: string,
): Promise<void> {
	const title = sheet.locator(':scope [data-slot="sheet-title"]');
	await expect(title).toHaveText(expected);
	expect(
		await title.evaluate((el) => {
			const style = getComputedStyle(el);
			return (
				style.position === "absolute" && el.getBoundingClientRect().width <= 1
			);
		}),
	).toBe(true);
}

// The inline date keeps each caller's own element; callers use time or span.
const INLINE_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

async function firstTransactionRow(page: Page): Promise<Locator> {
	await page.goto("/transactions");
	const button = page.getByRole("button", { name: /^View / }).first();
	await expect(button).toBeVisible();
	return page.getByRole("row").filter({ has: button }).first();
}

async function expectTransactionIconAlignment(
	row: Locator,
	viewportWidth: number,
): Promise<void> {
	const geometry = await row.evaluate((el) => {
		const name = el.querySelector("th") as HTMLElement;
		const icon = name.querySelector("[data-transaction-icon]") as HTMLElement;
		const title = name.querySelector("strong") as HTMLElement;
		const trigger = icon.parentElement as HTMLElement;
		const amount = el.querySelector("td:last-of-type") as HTMLElement;
		const table = el.closest('[data-slot="table"]') as HTMLElement;
		const rowBox = el.getBoundingClientRect();
		const nameBox = name.getBoundingClientRect();
		const iconBox = icon.getBoundingClientRect();
		const titleBox = title.getBoundingClientRect();
		const tableBox = table.getBoundingClientRect();
		const triggerStyle = getComputedStyle(trigger);
		const nameStyle = getComputedStyle(name);
		const amountStyle = getComputedStyle(amount);
		return {
			rowLeft: rowBox.left,
			nameLeft: nameBox.left,
			iconLeft: iconBox.left,
			iconRight: iconBox.right,
			titleLeft: titleBox.left,
			tableLeft: tableBox.left,
			namePaddingLeft: parseFloat(nameStyle.paddingLeft),
			triggerPaddingLeft: parseFloat(triggerStyle.paddingLeft),
			triggerGap: parseFloat(triggerStyle.columnGap),
			triggerTag: trigger.tagName,
			amountPaddingLeft: parseFloat(amountStyle.paddingLeft),
		};
	});
	const mobile = viewportWidth < 640;
	if (mobile) {
		expect(Math.abs(geometry.iconLeft - geometry.rowLeft)).toBeLessThanOrEqual(
			1,
		);
		expect(Math.abs(geometry.nameLeft - geometry.rowLeft)).toBeLessThanOrEqual(
			1,
		);
		expect(Math.abs(geometry.tableLeft - geometry.rowLeft)).toBeLessThanOrEqual(
			1,
		);
		expect(geometry.namePaddingLeft).toBe(0);
		expect(geometry.triggerPaddingLeft).toBe(0);
		expect(geometry.triggerGap).toBe(8);
		expect(geometry.amountPaddingLeft).toBe(8);
	} else {
		expect(Math.abs(geometry.iconLeft - geometry.nameLeft)).toBe(
			geometry.triggerTag === "BUTTON" ? 29 : 28,
		);
		expect(geometry.namePaddingLeft).toBe(20);
		expect(geometry.triggerPaddingLeft).toBe(8);
		expect(geometry.triggerGap).toBe(12);
		expect(geometry.amountPaddingLeft).toBe(12);
	}
	expect(
		Math.abs(geometry.titleLeft - (geometry.iconRight + geometry.triggerGap)),
	).toBeLessThanOrEqual(1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	// A layout that relies on clipped overflow would pass a visibility check
	// but still widen its scroll container, so measure the containers too.
	const geometry = await page.evaluate(() => {
		const table = document.querySelector('[data-slot="table-container"]');
		const sheetBody = document.querySelector('[data-slot="sheet-body"]');
		return {
			page: document.documentElement.scrollWidth - window.innerWidth,
			table: table ? table.scrollWidth - table.clientWidth : 0,
			sheet: sheetBody ? sheetBody.scrollWidth - sheetBody.clientWidth : 0,
		};
	});
	expect(geometry.page).toBeLessThanOrEqual(1);
	expect(geometry.table).toBeLessThanOrEqual(1);
	expect(geometry.sheet).toBeLessThanOrEqual(1);
}

// The detail metadata is a set of label/value rows. Their grid tracks must
// stay identical across rows and breakpoints; a flex label that only sizes to
// its own text would leave the values misaligned.
async function expectAlignedDetailRows(sheet: Locator): Promise<void> {
	const rows = sheet.locator("[data-detail-row]");
	await expect(rows.first()).toBeVisible();
	const measured = await rows.evaluateAll((elements) => {
		const parents = new Map<Element, number>();
		let next = 0;
		for (const el of elements) {
			const parent = el.parentElement;
			if (parent && !parents.has(parent)) parents.set(parent, next++);
		}
		return elements.map((el) => {
			const style = getComputedStyle(el);
			const label = el.firstElementChild as HTMLElement;
			const value = el.children[1] as HTMLElement;
			const labelBox = label.getBoundingClientRect();
			const valueBox = value.getBoundingClientRect();
			return {
				parent: el.parentElement ? (parents.get(el.parentElement) ?? -1) : -1,
				label: label.textContent?.trim() ?? "",
				display: style.display,
				tracks: style.gridTemplateColumns.trim().split(/\s+/).length,
				labelX: Math.round(labelBox.x),
				valueX: Math.round(valueBox.x),
				valueWidth: Math.round(valueBox.width),
				labelWrap: getComputedStyle(label).overflowWrap,
				overflow: el.scrollWidth - el.clientWidth,
			};
		});
	});
	expect(measured.length).toBeGreaterThanOrEqual(3);
	// These metadata rows are easy to leave stacked or floating; require them
	// in the aligned set so a future change cannot skip them silently.
	const labels = measured.map((row) => row.label);
	expect(labels).toContain("Category");
	expect(labels).not.toContain("Status");
	expect(labels).toContain("Account");
	expect(labels).toContain("Posted");
	await expectNoPostedBadge(sheet);
	for (const row of measured) {
		expect(row.display).toBe("grid");
		expect(row.tracks).toBe(2);
		expect(row.valueX).toBeGreaterThan(row.labelX + 8);
		expect(row.valueWidth).toBeGreaterThan(80);
		expect(row.labelWrap).not.toBe("normal");
		expect(row.overflow).toBeLessThanOrEqual(1);
	}
	const byParent = new Map<number, typeof measured>();
	for (const row of measured) {
		const group = byParent.get(row.parent) ?? [];
		group.push(row);
		byParent.set(row.parent, group);
	}
	for (const group of byParent.values()) {
		for (const row of group) {
			expect(row.labelX).toBe(group[0].labelX);
			expect(row.valueX).toBe(group[0].valueX);
		}
	}
}

// A user-assigned category shows the reset action. It must sit below the
// picker inside the value column; a reset beside the picker used to squeeze
// the picker until the label truncated on narrow viewports.
async function expectCategoryValueColumn(
	page: Page,
	sheet: Locator,
): Promise<void> {
	const row = sheet
		.locator("[data-detail-row]")
		.filter({ hasText: "Category" })
		.first();
	await expect(row).toBeVisible();
	await row.getByRole("combobox").click();
	await page.getByRole("option", { name: "Home improvement" }).click();
	const reset = row.getByRole("button", { name: "Use automatic" });
	await expect(reset).toBeVisible();
	const geometry = await row.evaluate((el) => {
		const value = el.children[1] as HTMLElement;
		const picker = value.querySelector('[role="combobox"]') as HTMLElement;
		const resetButton = [...value.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Use automatic"),
		) as HTMLElement;
		const text = picker.querySelector("span") as HTMLElement;
		const valueBox = value.getBoundingClientRect();
		const pickerBox = picker.getBoundingClientRect();
		const resetBox = resetButton.getBoundingClientRect();
		return {
			valueX: valueBox.x,
			valueRight: valueBox.right,
			valueWidth: valueBox.width,
			pickerX: pickerBox.x,
			pickerY: pickerBox.y,
			pickerWidth: pickerBox.width,
			resetX: resetBox.x,
			resetRight: resetBox.right,
			resetY: resetBox.y,
			textOverflow: text.scrollWidth - text.clientWidth,
		};
	});
	expect(geometry.pickerWidth).toBeGreaterThanOrEqual(geometry.valueWidth - 1);
	expect(geometry.pickerWidth).toBeLessThanOrEqual(geometry.valueWidth + 1);
	expect(Math.abs(geometry.pickerX - geometry.valueX)).toBeLessThanOrEqual(1);
	expect(geometry.resetX).toBeGreaterThanOrEqual(geometry.valueX - 1);
	expect(geometry.resetRight).toBeLessThanOrEqual(geometry.valueRight + 1);
	expect(geometry.resetY).toBeGreaterThan(geometry.pickerY);
	expect(geometry.textOverflow).toBeLessThanOrEqual(1);
}

type DetailRowTypography = {
	label: string;
	labelFontSize: number;
	labelWeight: string;
	labelColor: string;
	labelTextY: number;
	valueFontSize: number;
	valueWeight: string;
	valueTextX: number;
	valueTextY: number;
	rowHeight: number;
};

// Measure rendered text, not class names: label/value typography, the shared
// left inset, and the label's alignment to the first control all come from
// computed styles and text geometry at each viewport.
async function measureDetailTypography(
	sheet: Locator,
): Promise<DetailRowTypography[]> {
	return sheet.locator("[data-detail-row]").evaluateAll((rows) =>
		rows.map((row) => {
			const label = row.children[0] as HTMLElement;
			const value = row.children[1] as HTMLElement;
			const firstText = (element: Element) => {
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				let node: Node | null = null;
				while ((node = walker.nextNode())) {
					const text = node.textContent ?? "";
					const start = text.search(/\S/);
					if (start < 0) continue;
					// One character keeps the measurement on the first line
					// when a narrow label wraps.
					const range = document.createRange();
					range.setStart(node, start);
					range.setEnd(node, start + 1);
					const rect = range.getBoundingClientRect();
					if (rect.width === 0 && rect.height === 0) continue;
					return {
						rect,
						style: getComputedStyle(node.parentElement as Element),
					};
				}
				return null;
			};
			const labelText = firstText(label);
			const valueText = firstText(value);
			// Base UI selects keep an aria-hidden typeahead input next to the
			// trigger. It is not the visible control and sits outside the row.
			const candidate = value.matches("input")
				? value
				: (value.querySelector("input") as HTMLElement | null);
			const input =
				candidate &&
				candidate.getAttribute("aria-hidden") !== "true" &&
				candidate.getBoundingClientRect().width > 20
					? candidate
					: null;
			const inputStyle = input ? getComputedStyle(input) : null;
			const inputRect = input?.getBoundingClientRect();
			return {
				label: label.textContent?.trim() ?? "",
				labelFontSize: parseFloat(labelText?.style.fontSize ?? "0"),
				labelWeight: labelText?.style.fontWeight ?? "",
				labelColor: labelText?.style.color ?? "",
				labelTextY: labelText
					? labelText.rect.y + labelText.rect.height / 2
					: 0,
				valueFontSize: parseFloat(
					inputStyle?.fontSize ?? valueText?.style.fontSize ?? "0",
				),
				valueWeight:
					inputStyle?.fontWeight ?? valueText?.style.fontWeight ?? "",
				valueTextX: input
					? inputRect!.x +
						parseFloat(inputStyle!.paddingLeft) +
						parseFloat(inputStyle!.borderLeftWidth)
					: (valueText?.rect.x ?? value.getBoundingClientRect().x),
				valueTextY: input
					? inputRect!.y + inputRect!.height / 2
					: valueText
						? valueText.rect.y + valueText.rect.height / 2
						: 0,
				rowHeight: row.getBoundingClientRect().height,
			};
		}),
	);
}

async function expectDetailTypography(sheet: Locator, mobile: boolean) {
	const rows = await measureDetailTypography(sheet);
	expect(rows.length).toBeGreaterThanOrEqual(4);
	const expectedValueSize = mobile ? 16 : 14;
	for (const row of rows) {
		expect(row.labelFontSize, `${row.label} label font size`).toBe(14);
		expect(row.labelWeight, `${row.label} label weight`).toBe("500");
		expect(row.valueFontSize, `${row.label} value font size`).toBe(
			expectedValueSize,
		);
		expect(row.valueWeight, `${row.label} value weight`).toBe("400");
		expect(row.rowHeight, `${row.label} row height`).toBeGreaterThanOrEqual(32);
		expect(
			Math.abs(row.labelTextY - row.valueTextY),
			`${row.label} label/value centre`,
		).toBeLessThanOrEqual(2);
	}
	expect(new Set(rows.map((row) => row.labelColor)).size, "label colours").toBe(
		1,
	);
	const insetLabels = ["Account", "Occurred", "Posted", "Category"];
	const insetRows = rows.filter((row) => insetLabels.includes(row.label));
	expect(insetRows.length).toBeGreaterThanOrEqual(3);
	for (const row of insetRows) {
		expect(
			Math.abs(row.valueTextX - insetRows[0].valueTextX),
			`${row.label} value inset`,
		).toBeLessThanOrEqual(2);
	}
}

test("transaction detail sheet uses the canonical right-side shell", async ({
	page,
}) => {
	const { sheet, row } = await openTransactionDetail(page);
	const header = sheet.locator(':scope > [data-slot="sheet-header"]');
	const body = sheet.locator(':scope > [data-slot="sheet-body"]');
	await expect(header).toHaveCount(1);
	await expect(body).toHaveCount(1);
	await expectHiddenDetailTitle(sheet, "Transaction details");
	await expectHeaderRowAligned(sheet, true);
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

test("transaction row keeps the date column and icon on desktop", async ({
	page,
}) => {
	const row = await firstTransactionRow(page);
	await expect(row.locator("[data-transaction-icon]")).toBeVisible();
	const dateCell = row.locator("td").first();
	await expect(dateCell).toBeVisible();
	await expect(dateCell.getByText(INLINE_DATE)).toBeVisible();
	await expect(row.locator("th").getByText(INLINE_DATE)).toBeHidden();
	await expectNoHorizontalOverflow(page);
});

test("transaction title truncates only when its container constrains it", async ({
	page,
}) => {
	const title =
		"Long mobile transaction title that must use the full available column width at narrow mobile sizes";
	const noon = new Date();
	noon.setHours(12, 0, 0, 0);
	const postedTime = Math.floor(noon.getTime() / 1000);
	await appendModelTransactions([
		{
			id: "01900000-0000-7000-8000-000000000098",
			name: title,
			sourceAccountId: "checking",
			destinations: [],
			amount: {
				resolver: "expression",
				config: { expression: "5" },
				inputs: {},
			},
			postedTime,
			transactionTime: postedTime,
			enabled: true,
		},
	]);
	await page.goto("/transactions");
	await page.getByRole("textbox", { name: "Search transactions" }).fill(title);
	await expect(page.locator('[data-slot="table-body"] tr')).toHaveCount(1);
	const button = page.getByRole("button", {
		name: new RegExp(`^View ${title} `),
	});
	const row = page.getByRole("row").filter({ has: button }).first();
	await expect(row).toBeVisible();

	for (const viewport of [
		{ width: 390, height: 844, truncates: true },
		{ width: 320, height: 700, truncates: true },
		{ width: 1440, height: 1080, truncates: false },
	]) {
		await page.setViewportSize(viewport);
		await expect(row).toBeVisible();
		await expectTransactionIconAlignment(row, viewport.width);
		const geometry = await row.evaluate((el) => {
			const date = el.querySelector("td") as HTMLElement;
			const name = el.querySelector("th") as HTMLElement;
			const icon = name.querySelector("[data-transaction-icon]") as HTMLElement;
			const inlineDate = name.querySelector(
				"[data-transaction-mobile]",
			) as HTMLElement;
			const title = name.querySelector("strong") as HTMLElement;
			const titleColumn = title.parentElement as HTMLElement;
			const amount = el.querySelector("td:last-of-type") as HTMLElement;
			const amountContent = amount.querySelector("strong") as HTMLElement;
			const amountStyle = getComputedStyle(amount);
			const titleStyle = getComputedStyle(title);
			const amountBox = amount.getBoundingClientRect();
			const amountContentBox = amountContent.getBoundingClientRect();
			const container = el.closest(
				'[data-slot="table-container"]',
			) as HTMLElement;
			return {
				dateDisplay: getComputedStyle(date).display,
				iconDisplay: getComputedStyle(icon).display,
				inlineDateDisplay: getComputedStyle(inlineDate).display,
				titleWidth: title.getBoundingClientRect().width,
				titleColumnWidth: titleColumn.getBoundingClientRect().width,
				titleMaxWidth: titleStyle.maxWidth,
				titleOverflow: titleStyle.overflow,
				titleTextOverflow: titleStyle.textOverflow,
				titleScrollWidth: title.scrollWidth,
				titleClientWidth: title.clientWidth,
				amountWidth: amountBox.width,
				amountContentWidth: amountContentBox.width,
				amountContentRight: amountContentBox.right,
				amountRight: amountBox.right,
				amountPadding:
					parseFloat(amountStyle.paddingLeft) +
					parseFloat(amountStyle.paddingRight) +
					parseFloat(amountStyle.borderLeftWidth) +
					parseFloat(amountStyle.borderRightWidth),
				amountPaddingRight:
					parseFloat(amountStyle.paddingRight) +
					parseFloat(amountStyle.borderRightWidth),
				amountTextAlign: amountStyle.textAlign,
				rowOverflow: el.scrollWidth - el.clientWidth,
				tableOverflow: container.scrollWidth - container.clientWidth,
			};
		});
		const mobile = viewport.width < 640;
		expect(geometry.dateDisplay).toBe(mobile ? "none" : "table-cell");
		expect(geometry.iconDisplay).not.toBe("none");
		expect(geometry.inlineDateDisplay).toBe(mobile ? "block" : "none");
		expect(geometry.titleOverflow).toBe("hidden");
		expect(geometry.titleTextOverflow).toBe("ellipsis");
		// Container sizing replaces the retired character and viewport caps, so
		// a wide row may fit the full title while narrow rows still ellipsize.
		expect(geometry.titleMaxWidth).toBe("none");
		expect(
			Math.abs(geometry.titleWidth - geometry.titleColumnWidth),
		).toBeLessThanOrEqual(1);
		if (viewport.truncates) {
			expect(geometry.titleScrollWidth).toBeGreaterThan(
				geometry.titleClientWidth,
			);
		} else {
			expect(geometry.titleScrollWidth).toBeLessThanOrEqual(
				geometry.titleClientWidth + 1,
			);
		}
		expect(geometry.rowOverflow).toBeLessThanOrEqual(1);
		expect(geometry.tableOverflow).toBeLessThanOrEqual(1);
		expect(geometry.amountTextAlign).toBe("right");
		expect(geometry.amountContentWidth).toBeLessThanOrEqual(
			geometry.amountWidth - geometry.amountPadding + 1,
		);
		expect(
			Math.abs(
				geometry.amountContentRight -
					(geometry.amountRight - geometry.amountPaddingRight),
			),
		).toBeLessThanOrEqual(1);
		if (mobile) {
			expect(
				Math.abs(
					geometry.amountWidth -
						(geometry.amountContentWidth + geometry.amountPadding),
				),
			).toBeLessThanOrEqual(1);
		} else {
			expect(geometry.amountWidth).toBe(144);
		}
		await expectNoHorizontalOverflow(page);
	}
});

test("read-only transaction row aligns its icon without a mobile inset", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedReadOnlyStatement(api);
	} finally {
		await api.dispose();
	}
	await page.goto(`/accounts/${READ_ONLY_STATEMENT_CARD_ID}`);
	await page.getByRole("tab", { name: "Statements", exact: true }).click();
	const statements = page.getByRole("region", { name: "Card statements" });
	const row = statements
		.getByRole("row")
		.filter({ hasText: "Card statement" })
		.first();
	await expect(row).toBeVisible();
	await expect(row.locator('th > [data-slot="button"]')).toHaveCount(0);
	await expect(row.locator("th > div")).toHaveCount(1);

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 700 },
		{ width: 1440, height: 1080 },
	]) {
		await page.setViewportSize(viewport);
		await expect(row).toBeVisible();
		await expect(row.locator("[data-transaction-icon]")).toBeVisible();
		await expectTransactionIconAlignment(row, viewport.width);
		const inlineDate = row.locator("[data-transaction-mobile]");
		if (viewport.width < 640) await expect(inlineDate).toBeVisible();
		else await expect(inlineDate).toBeHidden();
		await expectNoHorizontalOverflow(page);
	}
});

test("transaction detail metadata uses aligned label and value rows", async ({
	page,
}) => {
	const { sheet } = await openTransactionDetail(page);
	await expectAlignedDetailRows(sheet);
	await expectDetailTypography(sheet, false);
	await expectNoHorizontalOverflow(page);
});

test("transaction detail has one editable header Name field", async ({
	page,
}) => {
	const { sheet } = await openTransactionDetail(page);
	const name = detailNameInput(sheet);
	await expect(name).toBeVisible();
	await expect(name).toHaveAttribute("required", "");
	await expect(name).toHaveAttribute("maxlength", "100");
	expect(await name.getAttribute("form")).toBeTruthy();
	await expect(sheet.getByLabel("Transaction name")).toHaveCount(0);
	await expect(sheet.getByLabel("Schedule name")).toHaveCount(0);
	await expectHiddenDetailTitle(sheet, "Transaction details");
});

test("schedule detail keeps the same single header Name field", async ({
	page,
}) => {
	await page.goto("/transactions");
	await page.getByRole("tab", { name: /^Recurring/ }).click();
	const row = page.getByRole("button", {
		name: /^View Student loan payment /,
	});
	await expect(row).toBeVisible();
	await row.click();
	const sheet = page.locator('[data-slot="sheet-content"]').first();
	await expect(sheet).toBeVisible();
	await expect(detailNameInput(sheet)).toHaveValue("Student loan payment");
	await expect(sheet.getByLabel("Schedule name")).toHaveCount(0);
	await expectHiddenDetailTitle(sheet, "Schedule details");
});

test("header Name edits save and survive a reopen", async ({ page }) => {
	await seedCardCharge();
	const sheet = await openNamedTransactionDetail(page, "Sheet parity charge");
	const name = detailNameInput(sheet);
	await expect(name).toHaveValue("Sheet parity charge");
	await name.fill("Renamed sheet charge");
	const save = sheet.getByRole("button", { name: "Save changes" });
	await expect(save).toBeEnabled();
	const saved = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname ===
				"/v1/transactions/01900000-0000-7000-8000-000000000099/amend" &&
			response.request().method() === "POST" &&
			response.ok(),
	);
	await save.click();
	expect((await saved).ok()).toBe(true);
	await expect(sheet).not.toBeVisible();
	const renamed = page.getByRole("button", {
		name: /^View Renamed sheet charge /,
	});
	await expect(renamed).toBeVisible();
	await renamed.click();
	const reopened = page.locator('[data-slot="sheet-content"]').first();
	await expect(detailNameInput(reopened)).toHaveValue("Renamed sheet charge");
});

test("header Name submits through its native form on Enter", async ({
	page,
}) => {
	await seedCardCharge();
	const sheet = await openNamedTransactionDetail(page, "Sheet parity charge");
	const name = detailNameInput(sheet);
	await name.fill("Enter submitted charge");
	await name.press("Enter");
	await expect(sheet).not.toBeVisible();
	const model = await readSavedServerModel();
	expect(
		model.transactions.some((row) => row.name === "Enter submitted charge"),
	).toBe(true);
});

test("header Name dirty edits are guarded by Cancel", async ({ page }) => {
	const { sheet } = await openTransactionDetail(page);
	const name = detailNameInput(sheet);
	await name.fill("Guarded header change");
	const cancel = sheet.getByRole("button", { name: "Cancel", exact: true });
	await cancel.click();
	const confirm = page.getByRole("alertdialog", {
		name: "Discard unsaved changes?",
	});
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Continue editing" }).click();
	await expect(name).toHaveValue("Guarded header change");
	await cancel.click();
	await confirm.getByRole("button", { name: "Discard changes" }).click();
	await expect(sheet).not.toBeVisible();
});

test("Amount is a plain nonnegative numeric field", async ({ page }) => {
	const { sheet } = await openTransactionDetail(page);
	await expect(sheet.getByText("Amount (USD)")).toHaveCount(0);
	const amount = sheet.getByRole("spinbutton", { name: "Amount", exact: true });
	await expect(amount).toBeVisible();
	expect(await amount.getAttribute("min")).toBe("0.01");
	const value = await amount.inputValue();
	expect(Number(value)).toBeGreaterThan(0);
	expect(value).not.toMatch(/[-+]/);
	const row = sheet
		.locator("[data-detail-row]")
		.filter({ hasText: "Amount" })
		.first();
	await expect(row.locator('[data-slot="input-group"]')).toHaveCount(0);
	expect(await row.textContent()).not.toContain("$");
});

test("transaction options sit in the shared row rhythm without a divider", async ({
	page,
}) => {
	const { sheet } = await openTransactionDetail(page);
	const options = sheet.getByRole("region", { name: "Transaction options" });
	await expect(options).toBeVisible();
	const style = await options.evaluate((el) => {
		const computed = getComputedStyle(el);
		return {
			borderTop: computed.borderTopWidth,
			marginTop: computed.marginTop,
			paddingTop: computed.paddingTop,
			rowGap: computed.rowGap,
		};
	});
	expect(style.borderTop).toBe("0px");
	expect(style.marginTop).toBe("0px");
	expect(style.paddingTop).toBe("0px");
	expect(parseFloat(style.rowGap)).toBeGreaterThan(0);
	const category = options
		.locator("[data-detail-row]")
		.filter({ hasText: "Category" })
		.first();
	await expect(category).toBeVisible();
	// Posted ends the main stack and Category begins the options stack. With
	// no separator, the two keep the same 12px rhythm as the rows inside them.
	const posted = sheet
		.locator("[data-detail-row]")
		.filter({ hasText: "Posted" })
		.first();
	const postedBox = await posted.boundingBox();
	const categoryBox = await category.boundingBox();
	expect(postedBox).not.toBeNull();
	expect(categoryBox).not.toBeNull();
	const gap = categoryBox!.y - (postedBox!.y + postedBox!.height);
	expect(gap).toBeGreaterThanOrEqual(10);
	expect(gap).toBeLessThanOrEqual(14);
});

test("posted date stays the only posting signal when it matches occurred", async ({
	page,
}) => {
	await seedCardCharge();
	const sheet = await openNamedTransactionDetail(page, "Sheet parity charge");
	const rows = sheet.locator("[data-detail-row]");
	await expect(rows.filter({ hasText: "Occurred" })).toBeVisible();
	const posted = rows.filter({ hasText: "Posted" });
	await expect(posted).toBeVisible();
	await expect(posted.locator("span").last()).toHaveText(INLINE_DATE);
	await expect(rows.filter({ hasText: "Status" })).toHaveCount(0);
	await expectNoPostedBadge(sheet);
});

test("both writable date rows are outlined controls with distinct names", async ({
	page,
}) => {
	const { sheet } = await openTransactionDetail(page);
	const rows = sheet.locator("[data-detail-row]");
	const occurred = rows.filter({ hasText: "Occurred" });
	const posted = rows.filter({ hasText: "Posted" });
	const occurredButton = occurred.getByRole("button");
	const postedButton = posted.getByRole("button");
	await expect(occurredButton).toBeVisible();
	await expect(postedButton).toBeVisible();
	for (const button of [occurredButton, postedButton]) {
		const cue = await button.evaluate((el) => {
			const text = el.querySelector("span") as HTMLElement;
			const icon = el.querySelector("svg") as SVGElement;
			return {
				borderWidth: parseFloat(getComputedStyle(el).borderTopWidth),
				textX: text.getBoundingClientRect().x,
				iconX: icon.getBoundingClientRect().x,
			};
		});
		expect(cue.borderWidth).toBeGreaterThanOrEqual(1);
		expect(cue.iconX).toBeGreaterThan(cue.textX);
	}
	await occurredButton.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Transaction dates" });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Occurred").fill("2026-11-20");
	await dialog.getByRole("button", { name: "Apply" }).click();
	await expect(occurred).toContainText("Nov 20, 2026");
	await postedButton.press("Enter");
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Posted").fill("2026-11-20");
	await dialog.getByRole("button", { name: "Apply" }).click();
	await expect(posted).toContainText("Nov 20, 2026");
	// Equal values still name the two triggers by their visible row labels.
	await expect(occurredButton).toHaveAccessibleName(
		/^Occurred .*Nov 20, 2026$/,
	);
	await expect(postedButton).toHaveAccessibleName(/^Posted .*Nov 20, 2026$/);
	await expectDetailTypography(sheet, false);
});

test.describe("read-only dates", () => {
	test.use({ fixtureOptions: { readOnly: true } });

	test("header Name and Amount stay read-only", async ({ page }) => {
		const { sheet } = await openTransactionDetail(page);
		const name = detailNameInput(sheet);
		const amount = sheet.getByRole("spinbutton", {
			name: "Amount",
			exact: true,
		});
		for (const input of [name, amount]) {
			expect(
				await input.evaluate((el) => (el as HTMLInputElement).readOnly),
			).toBe(true);
		}
		await expect(
			sheet.getByRole("button", { name: "Save changes" }),
		).toBeDisabled();
		await expect(name).toHaveAccessibleName("Name");
		await expectHeaderRowAligned(sheet, false);
	});

	test("stay static and noninteractive", async ({ page }) => {
		const { sheet } = await openTransactionDetail(page);
		const rows = sheet.locator("[data-detail-row]");
		await expect(
			rows.filter({ hasText: "Occurred" }).getByRole("button"),
		).toHaveCount(0);
		await expect(
			rows.filter({ hasText: "Posted" }).getByRole("button"),
		).toHaveCount(0);
		await expectDetailTypography(sheet, false);
	});
});

test("standalone transactions have no occurrence chooser", async ({ page }) => {
	await seedCardCharge();
	const sheet = await openNamedTransactionDetail(page, "Sheet parity charge");
	const rows = sheet.locator("[data-detail-row]");
	await expect(
		rows.filter({ hasText: "Records an occurrence of" }),
	).toBeVisible();
	await expect(rows.filter({ hasText: "Replaces occurrence on" })).toHaveCount(
		0,
	);
});

const claimStamp = Math.floor(Date.now() / 1000);

test.describe("occurrence chooser follows the schedule link", () => {
	test.use({
		fixtureOptions: {
			bankTransactions: [
				{
					id: "claim-pending-hold",
					description: "Claim pending hold",
					amount: "-40.00",
					posted: claimStamp,
					pending: true,
				},
			],
		},
	});

	async function seedClaimSchedule(today: string) {
		await appendModelSchedules([
			{
				id: "claim-test-schedule",
				name: "Claim test schedule",
				sourceAccountId: "checking",
				destinations: null,
				amount: {
					resolver: "expression",
					config: { expression: "40" },
					inputs: {},
				},
				recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
				startDate: today,
				endDate: null,
				annualCap: null,
				priority: 1,
				enabled: true,
			},
		]);
	}

	function todayLabel(today: string) {
		return new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			timeZone: "UTC",
		});
	}

	test("selecting a schedule reveals the chooser and clearing it drops the stale date", async ({
		page,
	}) => {
		const today = new Date().toISOString().slice(0, 10);
		await seedClaimSchedule(today);
		const sheet = await openNamedTransactionDetail(page, "Claim pending hold");
		const rows = sheet.locator("[data-detail-row]");
		const scheduleRow = rows.filter({ hasText: "Records an occurrence of" });
		const occurrenceRow = rows.filter({ hasText: "Replaces occurrence on" });
		await expect(scheduleRow.getByRole("combobox")).toBeVisible();
		await expect(occurrenceRow).toHaveCount(0);

		await scheduleRow.getByRole("combobox").click();
		await page.getByRole("option", { name: "Claim test schedule" }).click();
		await expect(occurrenceRow).toBeVisible();

		await occurrenceRow.getByRole("combobox").click();
		await page
			.getByRole("option")
			.filter({ hasText: INLINE_DATE })
			.first()
			.click();
		const chosenDateLabel = todayLabel(today);
		await expect(occurrenceRow.getByRole("combobox")).toContainText(
			chosenDateLabel,
		);
		// The link is shown once, by the claim fields themselves. There is no
		// second linked-occurrence capsule or direct Remove action in the body.
		await expect(
			sheet.getByText(/Replaces Claim test schedule occurrence on/),
		).toHaveCount(0);
		await expect(
			sheet.getByText("Claim test schedule", { exact: true }),
		).toHaveCount(1);
		await expect(
			sheet.getByRole("button", { name: /^Remove occurrence recorded by/ }),
		).toHaveCount(0);
		await expect(
			sheet.getByRole("button", { name: "Save changes" }),
		).toBeEnabled();

		await scheduleRow.getByRole("combobox").click();
		await page.getByRole("option", { name: "Standalone record" }).click();
		await expect(occurrenceRow).toHaveCount(0);

		await scheduleRow.getByRole("combobox").click();
		await page.getByRole("option", { name: "Claim test schedule" }).click();
		await expect(occurrenceRow).toBeVisible();
		await expect(occurrenceRow.getByRole("combobox")).toContainText(
			/Choose the occurrence|No claimable occurrences/,
		);
		await expectNoHorizontalOverflow(page);
	});

	test("a saved link shows once in the fields and unlink saving keeps the row", async ({
		page,
	}) => {
		const today = new Date().toISOString().slice(0, 10);
		await seedClaimSchedule(today);
		const noon = new Date();
		noon.setHours(12, 0, 0, 0);
		const posted = Math.floor(noon.getTime() / 1000);
		await appendModelTransactions([
			{
				id: "01900000-0000-7000-8000-0000000000c2",
				name: "Linked sheet charge",
				sourceAccountId: "checking",
				destinations: [],
				amount: {
					resolver: "expression",
					config: { expression: "40" },
					inputs: {},
				},
				postedTime: posted,
				transactionTime: posted,
				enabled: true,
				claim: { scheduleId: "claim-test-schedule", occurrenceDate: today },
			},
		]);
		const sheet = await openNamedTransactionDetail(page, "Linked sheet charge");
		const rows = sheet.locator("[data-detail-row]");
		await expect(
			rows.filter({ hasText: "Replaces occurrence on" }),
		).toBeVisible();
		// The link appears once, in the claim fields, with no second summary
		// or direct Remove action.
		await expect(
			sheet.getByText(/Replaces Claim test schedule occurrence on/),
		).toHaveCount(0);
		await expect(
			sheet.getByText("Claim test schedule", { exact: true }),
		).toHaveCount(1);
		await expect(
			sheet.getByRole("button", { name: /^Remove occurrence recorded by/ }),
		).toHaveCount(0);

		await rows
			.filter({ hasText: "Records an occurrence of" })
			.getByRole("combobox")
			.click();
		await page.getByRole("option", { name: "Standalone record" }).click();
		await expect(
			rows.filter({ hasText: "Replaces occurrence on" }),
		).toHaveCount(0);
		const save = sheet.getByRole("button", { name: "Save changes" });
		await expect(save).toBeEnabled();
		await save.click();
		await expect(sheet).not.toBeVisible();

		const model = await readSavedServerModel();
		const linked = model.transactions.find(
			(row) => row.name === "Linked sheet charge",
		);
		expect(linked).toBeDefined();
		expect(linked!.claim ?? null).toBeNull();
	});
});

test.describe("exception indicators without a status row", () => {
	test.use({
		fixtureOptions: {
			bankTransactions: [
				{
					id: "detail-pending-hold",
					description: "Detail pending hold",
					amount: "-30.00",
					posted: 1795712400,
					pending: true,
				},
			],
		},
	});
	test("pending and excluded keep their badges near the amount", async ({
		page,
	}) => {
		const noon = new Date();
		noon.setHours(12, 0, 0, 0);
		const stamp = Math.floor(noon.getTime() / 1000);
		await appendModelTransactions([
			{
				id: "01900000-0000-7000-8000-0000000000a3",
				name: "Detail excluded charge",
				sourceAccountId: "checking",
				destinations: [],
				amount: {
					resolver: "expression",
					config: { expression: "50" },
					inputs: {},
				},
				postedTime: stamp,
				transactionTime: stamp,
				enabled: false,
			},
		]);
		const cases = [
			{
				name: "Detail pending hold",
				badge: "Pending",
				posted: /Not yet posted/,
			},
			{
				name: "Detail excluded charge",
				badge: "Excluded from account",
				posted: INLINE_DATE,
			},
		];
		for (const item of cases) {
			const sheet = await openNamedTransactionDetail(page, item.name);
			const rows = sheet.locator("[data-detail-row]");
			await expect(rows.filter({ hasText: "Status" })).toHaveCount(0);
			await expect(
				sheet.locator('[data-slot="badge"]').filter({ hasText: item.badge }),
			).toBeVisible();
			await expectNoPostedBadge(sheet);
			await expect(
				rows.filter({ hasText: "Posted" }).locator("span").last(),
			).toHaveText(item.posted);
			await page.keyboard.press("Escape");
			await expect(sheet).not.toBeVisible();
		}
	});
	test("applying a posted date updates the pending row before save and persists", async ({
		page,
	}) => {
		const sheet = await openNamedTransactionDetail(page, "Detail pending hold");
		const posted = sheet
			.locator("[data-detail-row]")
			.filter({ hasText: "Posted" });
		await expect(posted.locator("span").last()).toHaveText("Not yet posted");
		await posted.getByRole("button").press("Enter");
		const dialog = page.getByRole("dialog", { name: "Transaction dates" });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel("Posted").fill("2026-11-27");
		await dialog.getByRole("button", { name: "Apply" }).click();
		await expect(posted.locator("span").last()).toHaveText("Nov 27, 2026");

		const save = sheet.getByRole("button", { name: "Save changes" });
		await expect(save).toBeEnabled();
		await save.click();
		await expect(sheet).not.toBeVisible();

		const reopened = await openNamedTransactionDetail(
			page,
			"Detail pending hold",
		);
		const reopenedPosted = reopened
			.locator("[data-detail-row]")
			.filter({ hasText: "Posted" });
		await expect(reopenedPosted.locator("span").last()).toHaveText(
			"Nov 27, 2026",
		);
		await expect(
			reopened.locator('[data-slot="badge"]').filter({ hasText: "Pending" }),
		).toHaveCount(0);
	});
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
	await detailNameInput(sheet).fill("Home renovation edited");
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
	// In a short viewport the tab content scrolls while the tab list and
	// fixed header stay put.
	const configureTabs = configure.getByRole("tablist");
	const configureContent = configure.locator(
		':scope [data-slot="tabs-content"]',
	);
	const bodyStyle = await configureBody.evaluate((el) => {
		const computed = getComputedStyle(el);
		return { overflowY: computed.overflowY, flexGrow: computed.flexGrow };
	});
	expect(bodyStyle.overflowY).toBe("hidden");
	expect(bodyStyle.flexGrow).toBe("1");
	const contentStyle = await configureContent.evaluate((el) => ({
		overflowY: getComputedStyle(el).overflowY,
	}));
	expect(contentStyle.overflowY).toBe("auto");
	const tabsBefore = await configureTabs.boundingBox();
	const scrolled = await configureContent.evaluate((el) => {
		const overflows = el.scrollHeight > el.clientHeight;
		if (overflows) el.scrollTop = el.scrollHeight;
		return { overflows, top: el.scrollTop };
	});
	expect(scrolled.overflows).toBe(true);
	expect(scrolled.top).toBeGreaterThan(0);
	const tabsAfter = await configureTabs.boundingBox();
	expect(tabsAfter?.y).toBe(tabsBefore?.y);
	const headerBox = await configureHeader.boundingBox();
	await configureContent.evaluate((el) => {
		el.scrollTop = 0;
	});
	const resetBox = await configureHeader.boundingBox();
	expect(resetBox?.y).toBe(headerBox?.y);
	const configureTitle = configure.locator(':scope [data-slot="sheet-title"]');
	const configureSave = configure.getByRole("button", {
		name: "Save",
		exact: true,
	});
	const configureClose = configure.getByRole("button", {
		name: "Close",
		exact: true,
	});
	const configureTitleBox = await configureTitle.boundingBox();
	const configureSaveBox = await configureSave.boundingBox();
	const configureCloseBox = await configureClose.boundingBox();
	expect(configureTitleBox!.x + configureTitleBox!.width).toBeLessThanOrEqual(
		configureSaveBox!.x + 1,
	);
	expect(configureSaveBox!.x + configureSaveBox!.width).toBeLessThanOrEqual(
		configureCloseBox!.x + 1,
	);
	expect(
		configureCloseBox!.x - (configureSaveBox!.x + configureSaveBox!.width),
	).toBeLessThanOrEqual(8);
	await page.keyboard.press("Escape");
	await expect(configure).not.toBeVisible();
	// The card's details action opens the same canonical shell, with the
	// shared transaction detail stacked above it.
	await card
		.getByRole("button", {
			name: /^(?:Transactions this cycle|\d+ transactions? this cycle)$/,
		})
		.click();
	const drawer = page.locator('[data-slot="sheet-content"]').first();
	await expect(drawer).toBeVisible();
	await expect(
		drawer.getByRole("heading", { name: "Spending this cycle" }),
	).toBeVisible();
	const drawerBox = await drawer.boundingBox();
	expect(drawerBox).not.toBeNull();
	expect(drawerBox!.width).toBe(configureBox!.width);
	const drawerHeader = drawer.locator(':scope > [data-slot="sheet-header"]');
	const drawerBody = drawer.locator(':scope > [data-slot="sheet-body"]');
	await expect(drawerHeader).toHaveCount(1);
	await expect(drawerBody).toHaveCount(1);
	const drawerTitle = drawer.locator(':scope [data-slot="sheet-title"]');
	const drawerClose = drawer.getByRole("button", {
		name: "Close",
		exact: true,
	});
	const drawerTitleBox = await drawerTitle.boundingBox();
	const drawerCloseBox = await drawerClose.boundingBox();
	expect(drawerTitleBox!.x + drawerTitleBox!.width).toBeLessThanOrEqual(
		drawerCloseBox!.x + 1,
	);
	const charge = drawer.getByRole("button", {
		name: /^View Sheet parity charge /,
	});
	await charge.click();
	const sheets = page.locator('[data-slot="sheet-content"]');
	await expect(sheets).toHaveCount(2);
	const nestedDetail = sheets.nth(1);
	await expect(nestedDetail).toBeVisible();
	const nestedDetailBox = await nestedDetail.boundingBox();
	expect(nestedDetailBox!.width).toBe(drawerBox!.width);
	await page.keyboard.press("Escape");
	await expect(nestedDetail).not.toBeVisible();
	await expect(drawer).toBeVisible();
	await expect(charge).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(drawer).not.toBeVisible();
	// A transaction detail opened from its own page uses the same shell.
	const { sheet: detail } = await openTransactionDetail(page);
	const detailBox = await detail.boundingBox();
	expect(detailBox).not.toBeNull();
	expect(detailBox!.width).toBe(configureBox!.width);
	const detailHeader = detail.locator(':scope > [data-slot="sheet-header"]');
	const detailBody = detail.locator(':scope > [data-slot="sheet-body"]');
	await expect(detailHeader).toHaveCount(1);
	await expect(detailBody).toHaveCount(1);
	const detailName = detailNameInput(detail);
	await expectHiddenDetailTitle(detail, "Transaction details");
	const detailClose = detail.getByRole("button", {
		name: "Close",
		exact: true,
	});
	const detailNameBox = await detailName.boundingBox();
	const detailCloseBox = await detailClose.boundingBox();
	expect(detailNameBox!.x + detailNameBox!.width).toBeLessThanOrEqual(
		detailCloseBox!.x + 1,
	);
});

test("safe spending keeps the transaction sort for the page session", async ({
	page,
}) => {
	await seedCardCharge();
	await page.goto("/outlook");
	const card = page.getByRole("region", { name: "Safe spending" });
	await expect(card.locator('[aria-busy="true"]')).toHaveCount(0);
	await card
		.getByRole("button", {
			name: /^(?:Transactions this cycle|\d+ transactions? this cycle)$/,
		})
		.click();
	const drawer = page.getByRole("dialog", { name: "Safe spending" });
	await drawer
		.getByRole("button", { name: /^Sort transactions: Newest first/ })
		.click();
	await expect(
		drawer.getByRole("button", { name: /^Sort transactions: Oldest first/ }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();

	await card
		.getByRole("button", {
			name: /^(?:Transactions this cycle|\d+ transactions? this cycle)$/,
		})
		.click();
	await expect(
		page
			.getByRole("dialog", { name: "Safe spending" })
			.getByRole("button", { name: /^Sort transactions: Oldest first/ }),
	).toBeVisible();
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
		await expectHiddenDetailTitle(sheet, "Transaction details");
		await expectHeaderRowAligned(sheet, true);
	});
	test("transaction row shows the icon and inline date without a date column", async ({
		page,
	}) => {
		const row = await firstTransactionRow(page);
		await expect(row.locator("[data-transaction-icon]")).toBeVisible();
		await expect(row.locator("td").first()).toBeHidden();
		await expect(row.locator("th").getByText(INLINE_DATE)).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});
	test("transaction detail metadata stays aligned in two columns", async ({
		page,
	}) => {
		const { sheet } = await openTransactionDetail(page);
		await expectAlignedDetailRows(sheet);
		await expectDetailTypography(sheet, true);
		await expectNoHorizontalOverflow(page);
	});
	test("category reset stays in the value column at mobile width", async ({
		page,
	}) => {
		const { sheet } = await openTransactionDetail(page);
		await expectCategoryValueColumn(page, sheet);
		await expectNoHorizontalOverflow(page);
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
	test("category reset stays in the value column at small width", async ({
		page,
	}) => {
		const { sheet } = await openTransactionDetail(page);
		await expectCategoryValueColumn(page, sheet);
		await expectNoHorizontalOverflow(page);
	});
	test("metadata typography and inset survive the small viewport", async ({
		page,
	}) => {
		const { sheet } = await openTransactionDetail(page);
		await expectDetailTypography(sheet, true);
		await expectCategoryValueColumn(page, sheet);
		await expectNoHorizontalOverflow(page);
	});
	test("transfer pickers and schedule inputs share the value inset", async ({
		page,
	}) => {
		await page.goto("/transactions");
		await page.getByRole("tab", { name: /^Recurring/ }).click();
		const row = page.getByRole("button", {
			name: /^View Student loan payment /,
		});
		await expect(row).toBeVisible();
		await row.click();
		const sheet = page.locator('[data-slot="sheet-content"]').first();
		await expect(sheet).toBeVisible();
		const measured = await measureDetailTypography(sheet);
		const byLabel = new Map(measured.map((row) => [row.label, row] as const));
		const scheduleName = byLabel.get("First occurrence");
		expect(scheduleName).toBeDefined();
		for (const label of ["From account", "To account", "Last occurrence"]) {
			const rowMeasurement = byLabel.get(label);
			expect(rowMeasurement, `${label} row`).toBeDefined();
			expect(
				Math.abs(rowMeasurement!.valueTextX - scheduleName!.valueTextX),
				`${label} text inset`,
			).toBeLessThanOrEqual(2);
			expect(rowMeasurement!.valueFontSize, `${label} font size`).toBe(16);
		}
		const rows = sheet.locator("[data-detail-row]");
		const fromPicker = rows
			.filter({ hasText: "From account" })
			.getByRole("combobox");
		await expect(fromPicker).toContainText("Everyday checking");
		expect(
			await fromPicker.evaluate((el) => {
				const text = el.querySelector("span") as HTMLElement;
				const range = document.createRange();
				range.selectNodeContents(text.firstChild!);
				return (
					range.getBoundingClientRect().right -
					text.getBoundingClientRect().right
				);
			}),
		).toBeLessThanOrEqual(1);
		await expect(
			rows.filter({ hasText: "To account" }).getByRole("combobox"),
		).toContainText("Student loan");
		await expectNoHorizontalOverflow(page);
	});
	test("recurring mobile cadence stays inside the name cell", async ({
		page,
	}) => {
		await page.goto("/transactions");
		await page.getByRole("tab", { name: /^Recurring/ }).click();
		const region = page.getByRole("region", {
			name: "Transactions with dates and amounts.",
		});
		const row = region
			.getByRole("row")
			.filter({ has: page.getByRole("button", { name: /^View / }) })
			.first();
		await expect(row).toBeVisible();
		const geometry = await row.evaluate((el) => {
			const name = el.querySelector("th") as HTMLElement;
			const amount = el.querySelector("td:last-of-type") as HTMLElement;
			const meta = name.querySelector(
				"[data-transaction-mobile]",
			) as HTMLElement;
			const nameBox = name.getBoundingClientRect();
			const amountBox = amount.getBoundingClientRect();
			const metaBox = meta.getBoundingClientRect();
			const style = getComputedStyle(meta);
			return {
				text: meta.textContent?.trim() ?? "",
				metaRight: metaBox.right,
				nameRight: nameBox.right,
				amountLeft: amountBox.left,
				overflow: meta.scrollWidth - meta.clientWidth,
				whiteSpace: style.whiteSpace,
				overflowWrap: style.overflowWrap,
			};
		});
		expect(geometry.text).not.toBe("");
		expect(geometry.metaRight).toBeLessThanOrEqual(geometry.nameRight + 1);
		expect(geometry.metaRight).toBeLessThanOrEqual(geometry.amountLeft + 1);
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		expect(geometry.whiteSpace).toBe("normal");
		expect(geometry.overflowWrap).not.toBe("normal");
		await expectNoHorizontalOverflow(page);
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
		const family = await title.evaluate(
			(el) => getComputedStyle(el).fontFamily,
		);
		expect(family).toMatch(/Merriweather/);
		await expect(detailNameInput(sheet)).toBeVisible();
	});
});
