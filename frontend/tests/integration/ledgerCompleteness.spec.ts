import { expect, request, test } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

// Ledger completeness in a real browser: the money diagram and the
// transaction screens show the shared ledger seed's known rows and sums.
// Runs only with INTEGRATION_PACK=ledger (the browser harness seeds the
// pack model on its own isolated ports); otherwise it skips instead of
// passing against the wrong seed. The harness seeds the pack's model rows
// only — bank-applied rows never enter through this path — so the sums
// below are the model-row subset, hand-computed beside the seed:
// paycheck 3000 x4 plus refund 45.50 in; rent 1200 x4, bookshop 42.50,
// cafe 75, clothes 125 out; payoff 500 x4 as transfers counted once.
// The transaction dialog lists recorded facts relative to the projection
// start, so the spec asks for projected activity the same way a viewer
// does; the forecast behind it is the real engine over real HTTP.

async function ledgerPresent(): Promise<boolean> {
	const api = await request.newContext();
	try {
		const response = await api.get(`${FIXTURE_API}/v1/transactions`);
		if (!response.ok()) return false;
		const body = await response.json();
		const rows = (body.transactions ?? []) as Array<{ name?: string }>;
		return rows.some((row) => row.name === "Paycheck January");
	} finally {
		await api.dispose();
	}
}

test("ledger diagram table shows every seeded flow with exact sums", async ({
	page,
}) => {
	test.skip(!(await ledgerPresent()), "needs INTEGRATION_PACK=ledger");
	await page.goto("/flows");
	await expect(
		page.getByRole("img", { name: /Money-flow diagram/ }),
	).toBeVisible();
	await page.getByLabel("From date", { exact: true }).fill("2026-01-01");
	await page.getByLabel("Through date", { exact: true }).fill("2026-04-30");
	await page
		.getByRole("group", { name: "Diagram or table view" })
		.getByRole("button", { name: "Table" })
		.click();
	const totals = page.getByRole("table", { name: /Window totals/ });
	await expect(totals).toBeVisible();
	await expect(totals).toContainText("$12,046");
	await expect(totals).toContainText("$5,043");
	await expect(totals).toContainText("$2,000");
	const table = page.getByRole("table", { name: /Money flows from/ });
	await expect(table).toBeVisible();
	await expect(table).toContainText(
		"Money in of $12,046 from Outside accounts to Checking",
	);
	await expect(table).toContainText(
		"Money out of $4,843 from Checking to Outside accounts",
	);
	await expect(table).toContainText("Transfer of $2,000 from Checking to Card");
	await expect(table).toContainText(
		"Money out of $200 from Card to Outside accounts",
	);
});

test("ledger checking history shows seeded rows with amounts and dates", async ({
	page,
}) => {
	test.skip(!(await ledgerPresent()), "needs INTEGRATION_PACK=ledger");
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Checking transactions" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Checking" });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Transaction source").selectOption("projected");
	await expect(dialog.getByRole("status")).toContainText(/Showing/, {
		timeout: 15000,
	});
	for (const merchant of [
		"Paycheck April",
		"Rent April",
		"Refund desk",
		"Card payoff February",
	]) {
		await expect(dialog).toContainText(merchant);
	}
	await expect(dialog).toContainText("+$3,000.00");
	await expect(dialog).toContainText("−$1,200.00");
	await expect(dialog).toContainText("Apr 15, 2026");
	await expect(dialog).toContainText("Showing 1–10 of 14 transactions");
	await dialog.getByRole("button", { name: "Next transaction page" }).click();
	await expect(dialog).toContainText("Showing 11–14 of 14 transactions");
	for (const merchant of ["Bookshop order", "Paycheck January"]) {
		await expect(dialog).toContainText(merchant);
	}
});
