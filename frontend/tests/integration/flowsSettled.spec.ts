import { expect, test, type Locator, type Page } from "./base.ts";

// The shared range picker stages an explicit window across two independently
// navigated month grids: walk each grid back to its target month, pick the
// boundary days by their full-date names, then Apply to commit the window.
// Day buttons carry the picker's short-month labels (for example
// "Jun 1, 2025"); grids expose their long-month titles as regions.
async function walkCalendarTo(
	dialog: Locator,
	calendar: 0 | 1,
	title: string,
	visibleCount: number,
): Promise<void> {
	const previous = dialog
		.getByRole("button", { name: /^Previous month/ })
		.nth(calendar);
	for (let step = 0; step < 72; step++) {
		if (
			(await dialog.getByRole("region", { name: title }).count()) >=
			visibleCount
		)
			break;
		await previous.click();
	}
	await expect(
		dialog.getByRole("region", { name: title }).nth(visibleCount - 1),
	).toBeVisible();
}

async function chooseRange(
	page: Page,
	start: { month: string; day: string },
	end: { month: string; day: string },
): Promise<void> {
	const dialog = page.getByRole("dialog", { name: "Choose date range" });
	await page.getByRole("button", { name: /^Date range:/ }).click();
	await expect(dialog).toBeVisible();
	await walkCalendarTo(dialog, 0, start.month, 1);
	await walkCalendarTo(
		dialog,
		1,
		end.month,
		start.month === end.month ? 2 : 1,
	);
	await dialog
		.getByRole("region", { name: start.month })
		.first()
		.getByRole("button", { name: start.day })
		.click();
	await dialog
		.getByRole("region", { name: end.month })
		.last()
		.getByRole("button", { name: end.day })
		.click();
	await dialog.getByRole("button", { name: "Apply" }).click();
}

// Settled bank history across seven months, every row posted before the
// fixture projection start: the projection emits no transaction events
// for these rows, so only the settled replay can draw recorded edges.
// Seven salaries of 3000 plus 29 grocery runs of 45 per month.
function settledHistory() {
	const rows: {
		id: string;
		description: string;
		amount: string;
		posted: number;
	}[] = [];
	for (let month = 5; month <= 11; month++) {
		rows.push({
			id: `salary-2025-${month}`,
			description: "Monthly salary",
			amount: "3000",
			posted: Date.UTC(2025, month, 15, 12) / 1000,
		});
		for (let i = 0; i < 29; i++) {
			rows.push({
				id: `grocery-2025-${month}-${i}`,
				description: "Grocery run",
				amount: "-45",
				posted: Date.UTC(2025, month, (i % 28) + 1, 12) / 1000,
			});
		}
	}
	return rows;
}

test.use({ fixtureOptions: { bankTransactions: settledHistory() } });

test("settled bank history draws recorded flows with exact totals", async ({
	page,
}) => {
	await page.goto("/flows");
	// Narrow to the seeded half-year so the window holds only settled
	// history: no fixture rows, no forecast occurrences.
	await chooseRange(
		page,
		{ month: "June 2025", day: "Jun 1, 2025" },
		{ month: "December 2025", day: "Dec 31, 2025" },
	);
	const status = page
		.getByRole("status")
		.filter({ hasText: /from 2025-06-01 through 2025-12-31/ });
	await expect(status).toContainText(/from 2025-06-01 through 2025-12-31/);
	await page
		.getByRole("group", { name: "Diagram or table view" })
		.getByRole("button", { name: "Table" })
		.click();
	const totals = page.getByRole("table", { name: /Window totals/ });
	await expect(totals).toBeVisible();
	// 7 x 3000 recorded in, 7 x 29 x 45 recorded out, no transfers on the
	// single seeded account, nothing planned in a history-only window.
	await expect(
		totals.getByRole("row", { name: /Recorded.*\$21,000.*\$9,135/ }),
	).toBeVisible();
	await expect(
		totals.getByRole("row", { name: /Planned \$0 \$0 \$0/ }),
	).toBeVisible();
	await expect(page.getByText(/edge totals reconcile/)).toBeVisible();
	// Narrowing to recorded money keeps both lanes: the history is
	// recorded, never planned.
	await page
		.getByRole("group", { name: "Recorded or planned money" })
		.getByRole("button", { name: "Recorded" })
		.click();
	const flows = page.getByRole("table", { name: /Money flows from/ });
	await expect(flows).toBeVisible();
	await expect(flows).not.toContainText("(planned)");
	await expect(
		flows.getByRole("row", { name: /Money in.*\$21,000/ }),
	).toBeVisible();
	await expect(
		flows.getByRole("row", { name: /Money out.*\$9,135/ }),
	).toBeVisible();
});

test("a window with no settled rows shows no money movement", async ({
	page,
}) => {
	await page.goto("/flows");
	await chooseRange(
		page,
		{ month: "January 2024", day: "Jan 1, 2024" },
		{ month: "January 2024", day: "Jan 31, 2024" },
	);
	await expect(
		page.getByRole("heading", { name: "No money movement in this view" }),
	).toBeVisible();
});
