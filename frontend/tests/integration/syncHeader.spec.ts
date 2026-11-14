import { expect, request, test, type Locator, type Page } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

// Observed on a 390px viewport after the CardHeader/CardAction composition:
// the connected SimpleFIN header kept its two-column grid, the CardAction
// controls claimed the second column beside the title, and the heading plus
// its description crushed against (and overlapped) the Sync now / Open
// SimpleFIN Bridge controls.
const SYNTHETIC_ACCESS_URL =
	"https://synthetic:fixture-only@bridge.invalid/simplefin";

async function seedSyncCredential(): Promise<void> {
	// The fixture API has no sync runner: the parse/store-only access-URL
	// branch performs no network call, so this is store-only seeding.
	const api = await request.newContext();
	try {
		const response = await api.post(
			`${FIXTURE_API}/v1/sync/simplefin/credential`,
			{ data: { accessUrl: SYNTHETIC_ACCESS_URL } },
		);
		if (!response.ok())
			throw new Error(
				`sync credential seed failed: ${response.status()} ${await response.text()}`,
			);
	} finally {
		await api.dispose();
	}
}

type Box = { x: number; y: number; width: number; height: number };

function disjoint(a: Box, b: Box): boolean {
	return (
		a.x + a.width <= b.x ||
		b.x + b.width <= a.x ||
		a.y + a.height <= b.y ||
		b.y + b.height <= a.y
	);
}

function within(inner: Box, outer: Box, tolerance = 2): boolean {
	return (
		inner.x >= outer.x - tolerance &&
		inner.x + inner.width <= outer.x + outer.width + tolerance &&
		inner.y >= outer.y - tolerance &&
		inner.y + inner.height <= outer.y + outer.height + tolerance
	);
}

test.describe("sync provider header narrow layout", () => {
	test.use({ viewport: { width: 390, height: 844 } });
	// The connected card renders from the credential alone, even when the
	// server has not enabled sync for the user (the read-only warning and
	// quota note may vary; the header composition must not).
	test("connected header stacks controls below the title", async ({ page }) => {
		await seedSyncCredential();
		await page.goto("/sources");
		const heading = page.getByRole("heading", {
			name: "SimpleFIN Connected",
			exact: true,
		});
		await expect(heading).toBeVisible();
		const card = heading.locator("xpath=ancestor::*[@data-slot='card'][1]");
		const description = card.locator('[data-slot="card-description"]');
		await expect(description).toBeVisible();
		expect((await description.textContent())?.trim().length).toBeGreaterThan(0);
		const action = card.locator('[data-slot="card-action"]');
		await expect(
			action.getByRole("button", { name: "Sync now" }),
		).toBeVisible();
		await expect(
			action.getByRole("link", { name: /Open SimpleFIN Bridge/ }),
		).toBeVisible();
		const headingBox = await heading.boundingBox();
		const descriptionBox = await description.boundingBox();
		const actionBox = await action.boundingBox();
		const cardBox = await card.boundingBox();
		expect(headingBox).not.toBeNull();
		expect(descriptionBox).not.toBeNull();
		expect(actionBox).not.toBeNull();
		expect(cardBox).not.toBeNull();
		// Narrow viewports stack the controls under the title block instead
		// of crushing beside it.
		expect(disjoint(headingBox!, actionBox!)).toBe(true);
		expect(disjoint(descriptionBox!, actionBox!)).toBe(true);
		expect(actionBox!.y).toBeGreaterThanOrEqual(
			Math.max(
				headingBox!.y + headingBox!.height,
				descriptionBox!.y + descriptionBox!.height,
			) - 2,
		);
		// The controls stay inside the card.
		expect(within(headingBox!, cardBox!)).toBe(true);
		expect(within(actionBox!, cardBox!)).toBe(true);
	});
});

test.describe("scrollable tab lists narrow layout", () => {
	test.use({ viewport: { width: 320, height: 700 } });
	// Observed at 320px: the scrollable line-variant tab lists kept the
	// stock centered layout while going full width, so the centered row
	// overflowed both edges and the first tab started left of the scrollport
	// with no way to scroll back to it.
	async function expectEndsReachable(
		page: Page,
		listName: string,
		firstName: string,
		lastName: string,
		firstPanelName: string | null = null,
	) {
		const list = page.getByRole("tablist", { name: listName });
		await expect(list).toBeVisible();
		const first = list.getByRole("tab", { name: firstName });
		const last = list.getByRole("tab", { name: lastName });
		// Fresh list rect per check: panel content swaps can shift layout
		// widths, and stale rects would assert against a dead scrollport.
		async function expectContained(tab: Locator) {
			const box = await list.boundingBox();
			expect(box).not.toBeNull();
			const tabBox = await tab.boundingBox();
			expect(tabBox).not.toBeNull();
			expect(tabBox!.x).toBeGreaterThanOrEqual(box!.x - 1);
			expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(
				box!.x + box!.width + 1,
			);
		}
		// Exact keyboard-only path, no scrollIntoView/click normalization:
		// establish on the first tab, End to the last, Enter to select it,
		// Home back, Space to select the first tab.
		await first.click();
		await expect(first).toHaveAttribute("aria-selected", "true");
		await expectContained(first);
		await page.keyboard.press("End");
		await expect(last).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(last).toHaveAttribute("aria-selected", "true");
		await expectContained(last);
		await page.keyboard.press("Home");
		await expect(first).toBeFocused();
		await page.keyboard.press("Space");
		await expect(first).toHaveAttribute("aria-selected", "true");
		await expectContained(first);
		if (firstPanelName !== null) {
			await expect(
				page.getByRole("tabpanel", { name: firstPanelName }),
			).toBeVisible();
		}
	}

	test("sources tabs keep every tab reachable", async ({ page }) => {
		await page.goto("/sources");
		await expectEndsReachable(
			page,
			"Configuration sections",
			"Bank sync",
			"Account",
			"Bank sync",
		);
	});

	test("inbox tabs keep every tab reachable", async ({ page }) => {
		await page.goto("/inbox");
		await expectEndsReachable(
			page,
			"Inbox status",
			"Pending",
			"Canceled",
			"Pending",
		);
	});
});
