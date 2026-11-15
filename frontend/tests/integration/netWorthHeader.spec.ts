import { expect, test, type Page } from "./base.ts";

// Observed on a 390px viewport after the CardHeader/CardAction composition:
// the header kept its two-column grid, the controls claimed nearly the full
// first row, and the net-worth amount crushed to ~12px wide, wrapping one
// character per line and overlapping the controls.
const PACK_ANCHORS: Record<string, string> = {
	"safe-spending": "2026-01-31",
};

// Seeded expectations only for packs this spec pins by anchor. Unknown packs
// keep the structural assertions without inventing an arbitrary width.
const PACK_AMOUNTS: Record<string, string> = {
	"safe-spending": "$361,200",
};

async function expectAmountClearOfControls(page: Page) {
	const anchor = PACK_ANCHORS[process.env.INTEGRATION_PACK ?? ""];
	if (anchor) {
		await page.clock.setFixedTime(new Date(`${anchor}T12:00:00Z`));
	}
	await page.goto("/outlook");
	const region = page.getByRole("region", {
		name: /Net worth over the trailing/,
	});
	await expect(
		region.getByRole("heading", { name: "Net worth" }),
	).toBeVisible();
	const amount = region.locator("strong").first();
	const expected = PACK_AMOUNTS[process.env.INTEGRATION_PACK ?? ""];
	if (expected) {
		await expect(amount).toContainText(expected);
	} else {
		await expect(amount).toContainText("$");
	}
	const controls = region.getByRole("group", { name: "Trailing window" });
	await expect(controls).toBeVisible();
	const amountBox = await amount.boundingBox();
	const controlsBox = await controls.boundingBox();
	expect(amountBox).not.toBeNull();
	expect(controlsBox).not.toBeNull();
	const overlaps = !(
		amountBox!.x + amountBox!.width <= controlsBox!.x ||
		controlsBox!.x + controlsBox!.width <= amountBox!.x ||
		amountBox!.y + amountBox!.height <= controlsBox!.y ||
		controlsBox!.y + controlsBox!.height <= amountBox!.y
	);
	expect(overlaps).toBe(false);
	// Narrow viewports stack the controls under the amount instead of
	// crushing beside it.
	expect(controlsBox!.y).toBeGreaterThanOrEqual(
		amountBox!.y + amountBox!.height - 2,
	);
}

async function paddingInline(node: {
	evaluate: <T>(fn: (el: HTMLElement) => T) => Promise<T>;
}) {
	return node.evaluate((el) => {
		const style = getComputedStyle(el);
		return {
			start: Number.parseFloat(style.paddingInlineStart),
			end: Number.parseFloat(style.paddingInlineEnd),
		};
	});
}

test.describe("net worth header narrow layout", () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test("amount stays clear of the trailing-window controls", async ({
		page,
	}) => {
		await expectAmountClearOfControls(page);
	});
	// The original report: safe-spending content rendered flush to the Card
	// edges. The loaded card owns exactly one header and one content slot,
	// each with nonzero horizontal padding; the footer keeps padding when
	// the tracked branch renders one.
	test("safe-spending slots keep horizontal padding", async ({ page }) => {
		const anchor = PACK_ANCHORS[process.env.INTEGRATION_PACK ?? ""];
		if (anchor) {
			await page.clock.setFixedTime(new Date(`${anchor}T12:00:00Z`));
		}
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(
			card.getByRole("heading", { name: "Safe spending" }),
		).toBeVisible();
		// Loaded body only: the pending skeleton carries aria-busy.
		await expect(card.locator('[aria-busy="true"]')).toHaveCount(0);
		const header = card.locator(':scope > [data-slot="card-header"]');
		const content = card.locator(':scope > [data-slot="card-content"]');
		const footer = card.locator(':scope > [data-slot="card-footer"]');
		await expect(header).toHaveCount(1);
		await expect(content).toHaveCount(1);
		for (const node of [header, content]) {
			const padding = await paddingInline(node);
			expect(padding.start).toBeGreaterThan(0);
			expect(padding.end).toBeGreaterThan(0);
		}
		if ((await footer.count()) > 0) {
			const padding = await paddingInline(footer);
			expect(padding.start).toBeGreaterThan(0);
			expect(padding.end).toBeGreaterThan(0);
		}
	});
});

test.describe("net worth header very narrow layout", () => {
	test.use({ viewport: { width: 320, height: 800 } });
	test("amount stays clear of the trailing-window controls", async ({
		page,
	}) => {
		await expectAmountClearOfControls(page);
	});
});
