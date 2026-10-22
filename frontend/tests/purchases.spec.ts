import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
	FinancialModelDocument,
	FinancialModelResponse,
} from "../src/api/contracts.ts";
import type { Plan } from "../src/domain/model.ts";
import { FIXTURE_API, readTemporaryVersion, resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function openPurchases(page: Page) {
	await page.goto("/#purchases");
	await expect(
		page.getByRole("heading", { level: 1, name: "Plan your purchases" }),
	).toBeVisible();
}

async function addPurchase(page: Page, name: string, cost: string) {
	await page.getByRole("button", { name: "Add purchase" }).click();
	const dialog = page.getByRole("dialog", { name: "Add purchase" });
	await dialog.getByLabel("Purchase name").fill(name);
	await dialog.getByLabel("Cost (USD)").fill(cost);
	await dialog.getByLabel("Funding account").selectOption("checking");
	await dialog.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(dialog).not.toBeVisible();
}

test("planned purchases has a navigation entry, direct route, and browser history", async ({
	page,
}) => {
	await page.goto("/#transactions");
	await expect(page.getByRole("tab", { name: /Wish list/ })).toHaveCount(0);
	await page
		.getByRole("link", { name: "Planned purchases", exact: true })
		.click();
	await expect(page).toHaveURL(/#purchases$/);
	await expect(
		page.getByRole("link", { name: "Planned purchases", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await expect(
		page.getByRole("heading", { level: 1, name: "Plan your purchases" }),
	).toBeFocused();
	await expect(page).toHaveTitle("Planned purchases · Waypoint");
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await expect(page).toHaveURL(/#transactions$/);
	await page.goBack();
	await expect(page).toHaveURL(/#purchases$/);
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Add purchase" }),
	).toBeVisible();
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
	test(`a dirty purchase form stays visible until discard is confirmed (${reducedMotion})`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion });
		await openPurchases(page);
		await page.getByRole("button", { name: "Add purchase" }).click();
		const dialog = page.getByRole("dialog", { name: "Add purchase" });
		await dialog.getByLabel("Purchase name").fill("Unsaved desk");
		await dialog.getByRole("button", { name: "Close dialog" }).click();
		await expect(dialog.getByRole("alert")).toContainText(
			"Discard the changes in this form?",
		);
		await expect(dialog.locator(":scope > div")).toHaveCSS("opacity", "1");
		await dialog.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(dialog.getByLabel("Purchase name")).toHaveValue(
			"Unsaved desk",
		);
		await dialog.press("Escape");
		await expect(dialog.getByRole("alert")).toContainText(
			"Discard the changes in this form?",
		);
		await dialog
			.getByRole("button", { name: "Discard changes", exact: true })
			.click();
		await expect(page.locator("dialog[open]")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Add purchase" }),
		).toBeFocused();
		await page.getByRole("button", { name: "Add purchase" }).click();
		await expect(dialog.getByLabel("Purchase name")).toHaveValue("");
		await dialog.getByRole("button", { name: "Close dialog" }).click();
		await expect(page.locator("dialog[open]")).toHaveCount(0);
	});
}

test("an editor can save a purchase with a synced account and pending UUID postings", async ({
	page,
	request,
}) => {
	const resource = {
		id: `plans/${"a".repeat(64)}`,
		kind: "private" as const,
		permissions: ["plan:read", "plan:project", "plan:write"],
	};
	const baselineResponse = await request.get(
		`${FIXTURE_API}/v1/financial-model`,
	);
	expect(baselineResponse.ok()).toBe(true);
	let { document: baseline } =
		(await baselineResponse.json()) as FinancialModelResponse;
	const pending = baseline?.postings.find(
		(posting) => posting.sourceAccountId === "checking",
	);
	if (!pending) throw new Error("The fixture needs a recorded outflow.");
	expect(pending.id).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
	);
	const disabled = await request.patch(
		`${FIXTURE_API}/v1/postings/${pending.id}`,
		{ data: { ...pending, enabled: false } },
	);
	expect(disabled.ok()).toBe(true);
	expect((await disabled.json()).persisted).toBe(true);
	baseline = (
		(await (
			await request.get(`${FIXTURE_API}/v1/financial-model`)
		).json()) as FinancialModelResponse
	).document;
	const status = await request.get(`${FIXTURE_API}/v1/status`);
	expect(status.ok()).toBe(true);
	expect(await status.json()).toMatchObject({ readOnly: false });

	// The fixture has no identity provider or sync runner. Supply their display
	// metadata only. Financial rows, projections, and purchase writes use the API.
	await page.route("**/v1/**", async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: { ...response.headers(), "X-Waypoint-Resource": resource.id },
		});
	});
	await page.route("**/v1/auth/session", async (route) => {
		await route.fulfill({
			headers: { "X-Waypoint-Resource": resource.id },
			json: {
				enabled: true,
				authenticated: true,
				allowed: true,
				resource,
				user: {
					subject: "purchase-editor",
					name: "Purchase editor",
					role: "editor",
				},
			},
		});
	});
	await page.route("**/v1/financial-model", async (route) => {
		const response = await route.fetch();
		const body = (await response.json()) as FinancialModelResponse;
		if (!body.document) throw new Error("The fixture model is missing.");
		await route.fulfill({
			response,
			headers: { ...response.headers(), "X-Waypoint-Resource": resource.id },
			json: {
				...body,
				document: {
					...body.document,
					checkpoints: body.document.checkpoints.map((checkpoint) =>
						checkpoint.AccountId === "checking"
							? { ...checkpoint, source: "simplefin" }
							: checkpoint,
					),
					postings: body.document.postings.map((posting) =>
						posting.id === pending.id
							? { ...posting, source: "simplefin", pending: true }
							: posting,
					),
				},
			},
		});
	});
	const unexpectedWrites: string[] = [];
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (
			/^(POST|PUT|PATCH|DELETE)$/.test(request.method()) &&
			(/^\/v1\/(accounts|checkpoints)(\/|$)/.test(path) ||
				(path === `/v1/postings/${pending.id}` &&
					/^(PATCH|DELETE)$/.test(request.method())))
		)
			unexpectedWrites.push(`${request.method()} ${path}`);
	});

	await openPurchases(page);
	await expect(
		page.getByText("Purchase editor", { exact: true }),
	).toBeVisible();
	await addPurchase(page, "Synced-account laptop", "500");
	const draft = (await readTemporaryVersion(page, resource)) as Plan;
	expect(draft.readOnly).toBe(false);
	expect(
		draft.accounts.find((account) => account.id === "checking"),
	).toMatchObject({
		readOnly: true,
		source: "Synced checkpoint",
	});
	expect(
		draft.movements.find((movement) => movement.id === pending.id),
	).toMatchObject({
		readOnly: true,
		pending: true,
		enabled: false,
	});
	await expect(
		page.getByText(/This change cannot be saved to the server/),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(page.getByText("Plan saved on the server.")).toBeVisible();
	expect(await readTemporaryVersion(page, resource)).toBeNull();
	const savedResponse = await request.get(`${FIXTURE_API}/v1/financial-model`);
	expect(savedResponse.ok()).toBe(true);
	const { document: saved } =
		(await savedResponse.json()) as FinancialModelResponse;
	expect(saved?.accounts).toEqual(baseline?.accounts);
	expect(saved?.checkpoints).toEqual(baseline?.checkpoints);
	expect(
		saved?.postings.filter(
			(posting) => posting.name !== "Synced-account laptop",
		),
	).toEqual(baseline?.postings);
	expect(
		saved?.postings.find((posting) => posting.name === "Synced-account laptop"),
	).toMatchObject({
		sourceAccountId: "checking",
		amount: { config: { expression: "500" } },
		purchase: { priority: 0 },
	});

	await page.reload();
	await expect(
		page
			.getByRole("list", { name: "Purchase priorities" })
			.getByRole("listitem"),
	).toContainText("Synced-account laptop");
	expect(await readTemporaryVersion(page, resource)).toBeNull();
	expect(unexpectedWrites).toEqual([]);
	expect(errors).toEqual([]);
});

test("purchase priorities persist and purchases protect all established payments", async ({
	page,
	request,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await openPurchases(page);
	await addPurchase(page, "Laptop", "500");
	await addPurchase(page, "Chair", "150");
	const queue = page.getByRole("list", { name: "Purchase priorities" });
	await expect(queue.locator("li").first()).toContainText("Laptop");
	await page.getByRole("button", { name: "Move Chair up" }).click();
	await expect(queue.locator("li").first()).toContainText("Chair");
	await expect(
		page.getByRole("status").filter({ hasText: "Chair is now priority 1" }),
	).toHaveText("Chair is now priority 1.");
	await expect(
		page.getByRole("list", { name: "Purchase dates" }).locator("time"),
	).toHaveCount(2);
	const temporary = await readTemporaryVersion(page);
	expect(
		temporary.movements.find((item: { name: string }) => item.name === "Chair")
			.purchasePriority,
	).toBe(0);
	await page.reload();
	await expect(queue.locator("li").first()).toContainText("Chair");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await expect(page.getByText("Plan saved on the server.")).toBeVisible();
	const response = await request.get(`${FIXTURE_API}/v1/financial-model`);
	const { document } = (await response.json()) as {
		document: FinancialModelDocument;
	};
	const chair = document.postings.find((item) => item.name === "Chair")!;
	expect(chair.purchase).toEqual({ priority: 0 });
	const projection = await request.post(
		`${FIXTURE_API}/v1/projections/deterministic`,
		{
			data: {
				document,
				settings: {
					fallbackProjectionStartDate: "2026-01-31",
					horizonYears: 20,
					evaluations: {
						...document.evaluations,
						plannedPurchases: [
							{
								instanceId: "purchases",
								name: "Planned purchases",
								enabled: true,
								config: {},
							},
						],
					},
				},
			},
		},
	);
	expect(projection.ok()).toBe(true);
	const { result } = await projection.json();
	const purchasesInBaseline = result.movementEvents.filter(
		(event: { origin: { postingId: string } }) =>
			document.postings.some(
				(posting) => posting.purchase && posting.id === event.origin.postingId,
			),
	);
	expect(purchasesInBaseline).toHaveLength(0);
	const analysis = result.evaluations.plannedPurchases[0].deterministic;
	expect(analysis.allFunded).toBe(true);
	expect(analysis.purchases).toHaveLength(2);
	expect(
		analysis.purchases.every((item: { date: string | null }) => item.date),
	).toBe(true);
	const withoutPurchases = await request.post(
		`${FIXTURE_API}/v1/projections/deterministic`,
		{
			data: {
				document: {
					...document,
					postings: document.postings.filter((item) => !item.purchase),
				},
				settings: {
					fallbackProjectionStartDate: "2026-01-31",
					horizonYears: 20,
					evaluations: document.evaluations,
				},
			},
		},
	);
	expect(withoutPurchases.ok()).toBe(true);
	const baseline = (await withoutPurchases.json()).result;
	expect(result.timeline).toEqual(baseline.timeline);
	expect(result.totals).toEqual(baseline.totals);
	expect(result.summary).toEqual(baseline.summary);
	expect(result.accountSummaries).toEqual(baseline.accountSummaries);
	expect(result.movementEvents).toEqual(baseline.movementEvents);
	expect(result.evaluations.financialIndependence).toEqual(
		baseline.evaluations.financialIndependence,
	);
	await page.getByRole("button", { name: "Edit Chair" }).click();
	const editor = page.getByRole("dialog", { name: "Edit purchase" });
	await editor.getByLabel("Cost (USD)").fill("200");
	await editor.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(queue.locator("li").first()).toContainText("$200");
	await page.getByRole("button", { name: "Remove Chair" }).click();
	await page
		.getByRole("button", { name: "Remove from unsaved changes" })
		.click();
	await expect(queue.locator("li")).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("unfunded purchases hold lower priorities and the page remains accessible on mobile", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/#transactions");
	await page.getByRole("button", { name: "Open navigation" }).click();
	await page
		.getByRole("link", { name: "Planned purchases", exact: true })
		.click();
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).not.toBeVisible();
	await expect(page).toHaveURL(/#purchases$/);
	await addPurchase(page, "Unfunded item", "1000000000");
	await addPurchase(page, "Small item", "25");
	await expect(page.getByText("Not funded within this timeframe")).toHaveCount(
		2,
	);
	await expect(
		page.getByRole("list", { name: "Purchase dates" }).locator("time"),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Move Small item up" }).focus();
	await page.keyboard.press("Enter");
	await expect(
		page
			.getByRole("list", { name: "Purchase priorities" })
			.getByRole("listitem")
			.first(),
	).toContainText("Small item");
	await expect(
		page.getByRole("list", { name: "Purchase dates" }).locator("time"),
	).toHaveCount(1);
	const audit = await new AxeBuilder({ page })
		.include('[aria-label="Planned purchases"]')
		.analyze();
	expect(audit.violations).toEqual([]);
	for (const width of [320, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
			`planned purchases at ${width}px`,
		).toBeLessThanOrEqual(width);
	}
});

test("read-only plans do not allow purchase writes", async ({ page }) => {
	await resetFixture({ readOnly: true });
	await openPurchases(page);
	await expect(
		page.getByRole("button", { name: "Add purchase" }),
	).toBeDisabled();
});
