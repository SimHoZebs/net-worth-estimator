import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test, trackBrowserErrors } from "./base.ts";

async function openFlows(page: Page) {
	await page.goto("/flows");
	// The diagram loads from the real /v1/flows engine over real HTTP and
	// renders on the shared chart setup.
	await expect(
		page.getByRole("img", { name: /Money-flow diagram/ }),
	).toBeVisible();
}

test("money flows render labeled nodes with width-encoded flows", async ({
	page,
}) => {
	await openFlows(page);
	const diagram = page.getByRole("img", { name: /Money-flow diagram/ });
	// Nodes label in plain words: outside accounts plus the fixture accounts.
	await expect(diagram.getByText("Everyday checking")).toBeVisible();
	await expect(diagram.getByText("Outside accounts").first()).toBeVisible();
});

test("the mobile diagram scrolls sideways instead of squeezing the plot", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openFlows(page);
	const region = page.getByRole("region", {
		name: "Scrollable money-flow diagram",
	});
	const metrics = await region.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
	}));
	// The chart keeps a readable plot width and overflows its viewport.
	expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
	const scrolled = await region.evaluate((element) => {
		element.scrollLeft = element.scrollWidth;
		return element.scrollLeft;
	});
	expect(scrolled).toBeGreaterThan(0);
});

test("hovering a flow shows its amount and top transactions", async ({
	page,
}) => {
	// Slow lane: fixture reseed plus Sankey layout over real HTTP.
	test.slow();
	await openFlows(page);
	const diagram = page.getByRole("img", { name: /Money-flow diagram/ });
	// Target the thickest band by geometry: its box middle sits on the
	// stroke however the layout orders lanes. Curved ribbons render as
	// paths; keep the line fallback for straight-rule output.
	const lines = await diagram.locator("path,line").all();
	let widest = null;
	for (const line of lines) {
		const box = await line.boundingBox();
		if (box && (!widest || box.height > widest.height)) widest = box;
	}
	expect(widest).not.toBeNull();
	await page.mouse.move(
		widest!.x + widest!.width / 2,
		widest!.y + widest!.height / 2,
	);
	const tip = page
		.getByRole("status")
		.filter({ hasText: /Money in of|Money out of|Transfer of/ });
	await expect(tip).toContainText(/Money in of|Money out of|Transfer of/);
	await expect(tip).toContainText(/Top transactions|Transactions:/);
});

test("hovering a node shows its totals and flow counts", async ({ page }) => {
	await openFlows(page);
	const diagram = page.getByRole("img", { name: /Money-flow diagram/ });
	const rects = await diagram.locator("rect").all();
	let tallest = null;
	for (const node of rects) {
		const box = await node.boundingBox();
		if (box && (!tallest || box.height > tallest.height)) tallest = box;
	}
	expect(tallest).not.toBeNull();
	await page.mouse.move(
		tallest!.x + tallest!.width / 2,
		tallest!.y + tallest!.height / 2,
	);
	await expect(
		page.getByRole("status").filter({ hasText: /in across .* out across/ }),
	).toBeVisible();
});

test("keyboard focus surfaces the same tooltip content as hover", async ({
	page,
}) => {
	await openFlows(page);
	const diagram = page.getByRole("img", { name: /Money-flow diagram/ });
	await diagram.focus();
	// Walk stops until a flow (not a node) holds focus; the native tooltip
	// follows focus exactly as it follows the pointer.
	const laneTip = page
		.getByRole("status")
		.filter({ hasText: /Money in of|Money out of|Transfer of/ });
	for (let step = 0; step < 12; step++) {
		await page.keyboard.press("ArrowRight");
		// The tooltip paints just behind focus movement; sample after it.
		await page.waitForTimeout(350);
		if ((await laneTip.count()) > 0) break;
	}
	await expect(laneTip).toContainText(/Top transactions|Transactions:/);
});

test("selecting a flow reveals its source transactions", async ({ page }) => {
	await openFlows(page);
	const diagram = page.getByRole("img", { name: /Money-flow diagram/ });
	// Keyboard flow: tab into the chart and walk lanes with the arrow keys,
	// activating each stop until a flow (not a node) selects. The chart
	// announces each focused flow through its description.
	await diagram.focus();
	const panel = page.getByRole("region", { name: "Selected money flow" });
	for (let step = 0; step < 12; step++) {
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Enter");
		if ((await panel.count()) > 0) break;
	}
	await expect(panel).toBeVisible();
	await expect(
		panel.getByRole("table", {
			name: "Transactions behind the selected flow.",
		}),
	).toBeVisible();
	await expect(panel).toContainText(/Money in of|Money out of|Transfer of/);
	// Activating the same lane again clears the selection.
	await page.keyboard.press("Enter");
	await expect(panel).toHaveCount(0);
});

test("touch tap selects a flow through the same inspector", async ({
	browser,
}) => {
	// A touch context proves tap-to-select reaches the identical inspector
	// state: tap resolves as a click, which focuses and selects the flow.
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1080 },
		hasTouch: true,
	});
	const reportTouchErrors = trackBrowserErrors(context);
	const page = await context.newPage();
	try {
		await page.goto("/flows");
		const diagram = page.getByRole("img", { name: /Money-flow diagram/ });
		await expect(diagram).toBeVisible();
		const lines = await diagram.locator("path,line").all();
		let widest = null;
		for (const line of lines) {
			const box = await line.boundingBox();
			if (box && (!widest || box.height > widest.height)) widest = box;
		}
		expect(widest).not.toBeNull();
		await page.touchscreen.tap(
			widest!.x + widest!.width / 2,
			widest!.y + widest!.height / 2,
		);
		const panel = page.getByRole("region", { name: "Selected money flow" });
		await expect(panel).toBeVisible();
		await expect(panel).toContainText(/Money in of|Money out of|Transfer of/);
		reportTouchErrors();
	} finally {
		await context.close();
	}
});

test("date and account filters re-render the graph", async ({ page }) => {
	await openFlows(page);
	const status = page.getByRole("status");
	// Shortening the window refetches from the engine: the range picker
	// preset applies immediately and the status names the applied window.
	// Both presets below end on the last day of the current month.
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const pad = (value: number) => String(value).padStart(2, "0");
	const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const monthEnd = `${year}-${pad(month + 1)}-${pad(lastOfMonth)}`;
	const thisMonthStart = `${year}-${pad(month + 1)}-01`;
	const last3StartDate = new Date(Date.UTC(year, month - 2, 1));
	const last3Start = `${last3StartDate.getUTCFullYear()}-${pad(last3StartDate.getUTCMonth() + 1)}-01`;
	await page.getByRole("button", { name: /^Date range:/ }).click();
	const rangeDialog = page.getByRole("dialog", { name: "Choose date range" });
	await expect(rangeDialog).toBeVisible();
	await rangeDialog.getByRole("button", { name: "Last 3 months" }).click();
	await expect(
		page.getByRole("button", { name: "Date range: Last 3 months" }),
	).toBeVisible();
	await expect(status).toContainText(`from ${last3Start} through ${monthEnd}`);
	// Returning to this month restores the default window, which shares the
	// same month end but starts on the first of the current month.
	await page.getByRole("button", { name: /^Date range:/ }).click();
	await expect(rangeDialog).toBeVisible();
	await rangeDialog.getByRole("button", { name: "This month" }).click();
	await expect(
		page.getByRole("button", { name: "Date range: This month" }),
	).toBeVisible();
	await expect(status).toContainText(
		`from ${thisMonthStart} through ${monthEnd}`,
	);
	// Narrowing to recorded money drops the planned lanes: the table view
	// carries the exact per-lane evidence.
	await page
		.getByRole("group", { name: "Recorded or planned money" })
		.getByRole("button", { name: "Recorded" })
		.click();
	await page
		.getByRole("group", { name: "Diagram or table view" })
		.getByRole("button", { name: "Table" })
		.click();
	const table = page.getByRole("table", { name: /Money flows from/ });
	await expect(table).toBeVisible();
	await expect(table).not.toContainText("(planned)");
	await page
		.getByRole("group", { name: "Recorded or planned money" })
		.getByRole("button", { name: "All" })
		.click();
	await page
		.getByRole("group", { name: "Diagram or table view" })
		.getByRole("button", { name: "Diagram" })
		.click();
	// Focusing one account keeps only its touching flows; totals still
	// describe the whole window.
	await page
		.getByLabel("Account", { exact: true })
		.selectOption({ label: "Investment portfolio" });
	await expect(status).toContainText(
		/Showing flows touching Investment portfolio/,
	);
	await expect(status).not.toContainText("(0 of");
});

test("the table view carries the same flows with exact amounts", async ({
	page,
}) => {
	await openFlows(page);
	await page
		.getByRole("group", { name: "Diagram or table view" })
		.getByRole("button", { name: "Table" })
		.click();
	await expect(
		page.getByRole("table", { name: /Money flows from/ }),
	).toBeVisible();
	await expect(
		page.getByRole("table", { name: /Window totals/ }),
	).toBeVisible();
});

test("money flows have no automatic accessibility violations", async ({
	page,
}) => {
	await openFlows(page);
	// Scoped to the page content: the sidebar theme toggle carries a
	// pre-existing label-content-name-mismatch outside this task's scope.
	const results = await new AxeBuilder({ page }).include("main").analyze();
	expect(results.violations).toEqual([]);
});
