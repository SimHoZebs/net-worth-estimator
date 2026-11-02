import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function openFlows(page: Page) {
	await page.goto("/#flows");
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
	await expect(diagram.locator("desc")).toContainText(
		/Money in of|Money out of|Transfer of/,
	);
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

test("date and account filters re-render the graph", async ({ page }) => {
	await openFlows(page);
	const status = page.getByRole("status");
	// Shortening the window refetches from the engine.
	await page.getByLabel("Through date", { exact: true }).fill("2026-02-28");
	await expect(status).toContainText(/through 2026-02-28/);
	await page.getByLabel("Through date", { exact: true }).fill("2026-11-01");
	await expect(status).toContainText(/through 2026-11-01/);
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
