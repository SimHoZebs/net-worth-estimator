import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function openFlows(page: Page) {
	await page.goto("/#flows");
	// The graph loads from the real /v1/flows engine over real HTTP.
	await expect(
		page.getByRole("group", { name: /Money-flow diagram/ }),
	).toBeVisible();
}

test("money flows render nodes with directional edges scaled by amount", async ({
	page,
}) => {
	await openFlows(page);
	const diagram = page.getByRole("group", { name: /Money-flow diagram/ });
	// Nodes: outside accounts plus the fixture accounts.
	await expect(
		diagram.getByText("Everyday checking", { exact: true }),
	).toBeVisible();
	// Edges are keyboard-operable with plain-language names carrying kind
	// and movement, so color never works alone.
	const edges = diagram.getByRole("button", { name: /Activate to inspect/ });
	expect(await edges.count()).toBeGreaterThan(0);
	// The fixture window holds planned payroll inflows and account
	// transfers; kind and movement ride in the name, never color alone.
	await expect(
		diagram.getByRole("button", { name: /Money in of .*\(planned\)/ }),
	).not.toHaveCount(0);
	await expect(
		diagram.getByRole("button", { name: /Transfer of / }),
	).not.toHaveCount(0);
});

test("selecting an edge reveals its source transactions", async ({ page }) => {
	await openFlows(page);
	const diagram = page.getByRole("group", { name: /Money-flow diagram/ });
	// Edges activate by keyboard: SVG path centers often miss the stroke,
	// so a pointer click is the wrong tool here.
	const edge = diagram
		.getByRole("button", { name: /Money in of .*\(planned\)/ })
		.first();
	await edge.focus();
	await page.keyboard.press("Enter");
	const panel = page.getByRole("region", { name: "Selected money flow" });
	await expect(panel).toBeVisible();
	await expect(
		panel.getByRole("table", { name: "Transactions behind the selected flow." }),
	).toBeVisible();
});

test("date and account filters re-render the graph", async ({ page }) => {
	await openFlows(page);
	const diagram = page.getByRole("group", { name: /Money-flow diagram/ });
	const status = page.getByRole("status");
	// Shortening the window refetches from the engine.
	await page.getByLabel("Through date", { exact: true }).fill("2026-02-28");
	await expect(status).toContainText(/through 2026-02-28/);
	await page.getByLabel("Through date", { exact: true }).fill("2026-11-01");
	await expect(status).toContainText(/through 2026-11-01/);
	// Narrowing to recorded money drops the planned edges.
	await page
		.getByRole("group", { name: "Recorded or planned money" })
		.getByRole("button", { name: "Recorded" })
		.click();
	await expect(diagram.getByRole("button", { name: /\(planned\)/ })).toHaveCount(
		0,
	);
	await page
		.getByRole("group", { name: "Recorded or planned money" })
		.getByRole("button", { name: "All" })
		.click();
	await expect(
		diagram.getByRole("button", { name: /\(planned\)/ }),
	).not.toHaveCount(0);
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
