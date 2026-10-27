import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { FinancialModelDocument } from "../src/api/contracts.ts";
import {
	FIXTURE_API,
	REMOTE_STORAGE_KEY,
	readSavedServerPlan,
	readTemporaryVersion,
	resetFixture,
	seedResourceStorage,
} from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture({ pinnedEvaluationIds: ["posting-fulfillment"] });
});

/** Open the movement editor for the fixture's investing transfer. */
async function openInvestingMovementEditor(page: Page) {
	await page.getByRole("link", { name: "Transactions", exact: true }).click();
	await page.getByRole("button", { name: "Monthly investing" }).click();
	await page.getByLabel("Amount (USD)").click();
}

const issues = (
	violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
) =>
	violations.map((violation) => ({
		rule: violation.id,
		nodes: violation.nodes.map((node) => ({
			selector: node.target,
			message: node.failureSummary,
		})),
	}));

test("outlook renders real calculations and evidence", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Your financial outlook" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Open navigation" }),
	).not.toBeVisible();
	// Values come from the Go engine over HTTP, not a client-side projection.
	await expect(page.getByText("$361,200")).toBeVisible();
	// The trailing graph draws the last 30 days of that same calculation.
	await page.getByRole("slider", { name: "Inspect net worth date" }).waitFor();
	await page.getByRole("button", { name: "Inspect cash flow" }).click();
	await expect(page.getByRole("dialog")).toContainText("$2,650 short");
	await expect(page.getByRole("dialog")).toContainText("Mar 6, 2026");
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Inspect cash flow" }),
	).toBeFocused();
	expect(errors).toEqual([]);
});

test("saved target pins control Outlook without an evidence dialog", async ({
	page,
	request,
}) => {
	const response = await request.get(`${FIXTURE_API}/v1/financial-model`);
	expect(response.ok()).toBe(true);
	const { document } = (await response.json()) as {
		document: FinancialModelDocument;
	};
	const evaluation = document.evaluations.netWorthThreshold.find(
		(item) => item.enabled,
	)!;
	const card = () =>
		page.getByRole("region", { name: evaluation.name, exact: true });
	const pinWrite = () =>
		page.waitForResponse(
			(reply) =>
				reply.url().endsWith("/v1/pinned-evaluations") &&
				reply.request().method() === "PUT",
		);
	await page.goto("/#evaluations");
	await expect(card()).toBeVisible();
	await page.getByRole("link", { name: "Outlook", exact: true }).click();
	await expect(page.getByText(evaluation.name, { exact: true })).toHaveCount(0);
	await page.getByRole("link", { name: "Evaluations", exact: true }).click();
	const saved = pinWrite();
	await card().locator("button[aria-pressed]").click();
	expect((await saved).ok()).toBe(true);
	await page.getByRole("link", { name: "Outlook", exact: true }).click();
	await expect(card()).toBeVisible();
	await expect(page.getByText(evaluation.name, { exact: true })).toHaveCount(1);
	await expect(card().getByRole("button", { name: /Evidence/ })).toHaveCount(0);
	await expect(page.getByRole("dialog")).not.toBeVisible();
	const removed = pinWrite();
	await card().getByRole("button", { pressed: true }).click();
	expect((await removed).ok()).toBe(true);
	await expect(card()).toHaveCount(0);
	await page.reload();
	const pins = await request.get(`${FIXTURE_API}/v1/pinned-evaluations`);
	expect(pins.ok()).toBe(true);
	expect((await pins.json()).instanceIds).not.toContain(evaluation.instanceId);
	await expect(page.getByText(evaluation.name, { exact: true })).toHaveCount(0);
});

test("edits remain temporary, persist across reload, and save deliberately", async ({
	page,
}) => {
	await page.goto("/");
	await openInvestingMovementEditor(page);
	await page.getByLabel("Amount (USD)").fill("900");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(
		page.getByText("1 unsaved change · saved plan unchanged"),
	).toBeVisible();
	await page.reload();
	await expect(
		page.getByText("1 unsaved change · saved plan unchanged"),
	).toBeVisible();
	await page.getByRole("button", { name: "Save changes" }).click();
	// Synchronize on save completion, not on the banner flipping to its
	// loading text: the "unsaved change" copy disappears the moment the
	// save starts, while the draft is only cleared after the server
	// roundtrips finish. Reloading on the loading text races the save and
	// restores a stale draft.
	await expect(page.getByText("Plan saved on the server.")).toBeVisible();
	await page.reload();
	// The save reached the server, and the unsaved changes are gone.
	const saved = await readSavedServerPlan();
	expect(
		saved.recurrenceRules.find((rule) => rule.id === "invest")?.amount.config
			.expression,
	).toBe("900");
	expect(await readTemporaryVersion(page)).toBeNull();
});

test("discard is explicit and restores the saved plan", async ({ page }) => {
	await page.goto("/");
	await openInvestingMovementEditor(page);
	await page.getByLabel("Amount (USD)").fill("999");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText(
		"Return to your saved plan?",
	);
	await page.getByRole("button", { name: "Keep exploring" }).click();
	await expect(
		page.getByText("1 unsaved change · saved plan unchanged"),
	).toBeVisible();
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	await page
		.getByRole("button", { name: "Discard changes", exact: true })
		.click();
	await expect(
		page.getByText("1 unsaved change · saved plan unchanged"),
	).not.toBeVisible();
});

test("account, movement and evaluation maintenance plus search work", async ({
	page,
}) => {
	await page.goto("/#accounts");
	await page.getByRole("button", { name: "Add account" }).click();
	await page.getByLabel("Account name").fill("Travel savings");
	await page.getByLabel("Balance (USD)", { exact: true }).fill("2500");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	await page.getByRole("textbox", { name: "Search plan" }).fill("Travel");
	await expect(page.getByRole("row", { name: /Travel savings/ })).toBeVisible();
	await page.getByRole("link", { name: "Evaluations", exact: true }).click();
	await page
		.getByRole("button", { name: "Add evaluation", exact: true })
		.click();
	await page.getByLabel("Evaluation name").fill("Next big trip");
	await page.getByLabel("Measure", { exact: true }).selectOption("reserve");
	await page
		.getByLabel("Account", { exact: true })
		.selectOption({ label: "Travel savings" });
	await page.getByLabel("Target (USD)").fill("5000");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(
		page.getByRole("heading", { name: "Next big trip" }),
	).toBeVisible();
});

test("failed saves retain the intended plan", async ({ page }) => {
	await page.goto("/#sources");
	await openInvestingMovementEditor(page);
	await page.getByLabel("Amount (USD)").fill("900");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	// The server rejects the write, so the unsaved changes must survive.
	await page.route("**/v1/recurrence-rules/*", async (route) => {
		if (route.request().method() === "PATCH")
			return route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ error: "injected failure" }),
			});
		return route.continue();
	});
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "HTTP 500" }),
	).toBeVisible();
	await expect(
		page.getByText("1 unsaved change · saved plan unchanged"),
	).toBeVisible();
	const draft = await readTemporaryVersion(page);
	expect(
		draft?.movements.find(
			(movement: { id: string }) => movement.id === "invest",
		)?.amount,
	).toBe(900);
});

test("corrupt persisted data never silently falls back to example content", async ({
	page,
}) => {
	// The remote workspace key holds the unsaved changes. Corrupt it and the
	// app must surface a recovery path rather than invent a plan.
	await seedResourceStorage(page, REMOTE_STORAGE_KEY, "invalid");
	await page.goto("/");
	const storageNotice = page
		.getByRole("alert")
		.filter({ hasText: "could not be read" });
	await expect(storageNotice).toContainText(
		"Stored remote workspace data could not be read",
	);
	await expect(storageNotice).toContainText(
		"Your saved plan has not been replaced",
	);
	// The canonical server model is still shown, not example content.
	await expect(
		page.getByText("$361,200", { exact: true }).first(),
	).toBeVisible();
});

test("desktop pages and edit dialogs meet automated accessibility checks", async ({
	page,
}) => {
	for (const path of [
		"/",
		"/#accounts",
		"/#transactions",
		"/#purchases",
		"/#evaluations",
		"/#sources",
	]) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze();
		expect(issues(results.violations), path).toEqual([]);
	}
	await page.goto("/");
	await openInvestingMovementEditor(page);
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
		.analyze();
	expect(issues(results.violations)).toEqual([]);
});

for (const width of [1440, 390]) {
	test(`dark theme pages and account editor remain accessible at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ colorScheme: "dark" });
		for (const route of [
			"outlook",
			"accounts",
			"transactions",
			"purchases",
			"evaluations",
			"sources",
		]) {
			await page.goto(`/#${route}`);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
				route,
			).toBeLessThanOrEqual(width);
			const audit = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
				.analyze();
			expect(issues(audit.violations), route).toEqual([]);
		}
		await page.goto("/#accounts");
		await page.getByRole("button", { name: "Add account" }).click();
		await expect(page.getByRole("dialog")).toBeVisible();
		const audit = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze();
		expect(issues(audit.violations)).toEqual([]);
	});
}

test("mobile navigation, evidence and layouts stay usable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const { route, label } of [
		{ route: "accounts", label: "Accounts" },
		{ route: "transactions", label: "Transactions" },
		{ route: "purchases", label: "Planned purchases" },
		{ route: "sources", label: "Configs" },
	]) {
		await page.goto(`/#${route}`);
		const openNavigation = page.getByRole("button", {
			name: "Open navigation",
		});
		await openNavigation.click();
		await page.getByRole("link", { name: label, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`#${route}$`));
		await expect(
			page.getByRole("dialog", { name: "Workspace navigation" }),
		).not.toBeVisible();
		await expect(openNavigation).toBeFocused();
	}
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Your financial outlook" }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await page.getByRole("button", { name: "Open navigation" }).click();
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByRole("button", { name: "Add account" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	const overflow = await page.evaluate(() => ({
		width: innerWidth,
		documentWidth: document.documentElement.scrollWidth,
		elements: Array.from(document.querySelectorAll("*"))
			.filter(
				(element) => element.getBoundingClientRect().right > innerWidth + 1,
			)
			.map((element) => ({
				tag: element.tagName,
				right: element.getBoundingClientRect().right,
			})),
	}));
	expect(overflow.documentWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
		overflow.width,
	);
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
		.analyze();
	expect(issues(results.violations)).toEqual([]);
	await page.keyboard.press("Escape");
	await page.goto("/");
	await page.getByRole("slider", { name: "Inspect net worth date" }).waitFor();
	await page.screenshot({
		path: "test-results/waypoint-mobile.png",
		fullPage: true,
	});
});

test("capture the completed desktop outlook", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("slider", { name: "Inspect net worth date" }).waitFor();
	await page.screenshot({
		path: "test-results/waypoint-desktop.png",
		fullPage: true,
	});
});

test("scenario failures expose a recovery action without inventing a range", async ({
	page,
}) => {
	// Server mode streams the range over SSE, so failing the stream is the
	// equivalent of a worker that cannot start. The history graph draws no
	// range, so recovery surfaces through the notification action while the
	// deterministic cards stay visible.
	await page.route("**/v1/projections/stochastic", (route) => route.abort());
	await page.goto("/");
	await expect(page.getByRole("alert")).toContainText("The API request failed");
	await expect(
		page.getByRole("button", { name: "Retry scenario calculation" }),
	).toBeVisible();
	await expect(page.getByText("$361,200")).toBeVisible();
	// The history graph draws no range, so a failed stream must not add one.
	await expect(
		page.getByRole("region", { name: "Net worth over the trailing 30 days" }),
	).not.toContainText("80%");
});

test("read-only plans can be explored but not saved", async ({ page }) => {
	await resetFixture({ readOnly: true });
	await page.goto("/#sources");
	// The saved-model banner is gone; the sync tab's launcher carries the
	// read-only state now.
	await expect(
		page.getByRole("button", { name: "Connect SimpleFIN" }),
	).toBeDisabled();
	await openInvestingMovementEditor(page);
	await page.getByLabel("Amount (USD)").fill("900");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	// Unsaved changes are allowed; saving them back to the source is not.
	await expect(
		page.getByText("1 unsaved change · saved plan unchanged"),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Save changes" }),
	).toBeDisabled();
});

test("a second tab cannot overwrite newer financial work", async ({
	page,
	context,
}) => {
	await page.goto("/");
	const other = await context.newPage();
	await other.goto("/");
	await openInvestingMovementEditor(other);
	await other.getByLabel("Amount (USD)").fill("1200");
	await other.getByRole("button", { name: "Apply unsaved changes" }).click();
	await openInvestingMovementEditor(page);
	await page.getByLabel("Amount (USD)").fill("1300");
	await page.getByRole("button", { name: "Apply unsaved changes" }).click();
	await expect(page.getByRole("alert")).toContainText("another tab");
	const stored = await readTemporaryVersion(page);
	// The newer write from the other tab is what survives.
	expect(
		stored.movements.find(
			(movement: { id: string }) => movement.id === "invest",
		).amount,
	).toBe(1200);
	await other.close();
});

test("tabs use arrow-key navigation and all main pages fit narrow screens", async ({
	page,
}) => {
	await page.goto("/#accounts");
	await expect(page.getByRole("tab")).toHaveCount(0);
	await page.goto("/#transactions");
	await expect(page.getByRole("tab")).toHaveCount(2);
	await page.getByRole("tab", { name: /All transactions/ }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("tab", { name: /Recurring/ })).toBeFocused();
	await page.getByRole("tab", { name: /Recurring/ }).click();
	await expect(page.getByRole("tab", { name: /Recurring/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("ArrowRight");
	await expect(
		page.getByRole("tab", { name: /All transactions/ }),
	).toBeFocused();
	await expect(
		page.getByRole("heading", { name: "The inputs behind the outlook" }),
	).not.toBeVisible();
	await page.goto("/#sources");
	await expect(page.getByRole("tab", { name: "Bank sync" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Amounts" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Assumptions" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "Account" })).toBeVisible();
	await page.getByRole("tab", { name: "Assumptions" }).click();
	await expect(
		page.getByRole("heading", { name: "The inputs behind the outlook" }),
	).toBeVisible();
	await expect(page.getByLabel("Annual inflation (%)")).toBeVisible();
	await expect(
		page.getByLabel("Investment return variability (%)"),
	).toBeVisible();
	for (const width of [320, 768, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		for (const route of [
			"outlook",
			"accounts",
			"transactions",
			"purchases",
			"evaluations",
			"sources",
		]) {
			await page.goto(`/#${route}`);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
				`${route} at ${width}px`,
			).toBeLessThanOrEqual(width);
		}
	}
});

test("evidence dialogs and the mobile navigation preserve accessible semantics", async ({
	page,
}) => {
	await page.goto("/");
	for (const action of [
		"Inspect current net worth evidence",
		"Inspect cash flow",
	]) {
		await page.getByRole("button", { name: action }).click();
		await expect(page.getByRole("dialog")).toBeVisible();
		const result = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze();
		expect(issues(result.violations), action).toEqual([]);
		await page.keyboard.press("Escape");
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Open navigation" }).click();
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).toBeVisible();
	const result = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
		.analyze();
	expect(issues(result.violations)).toEqual([]);
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("dialog", { name: "Workspace navigation" }),
	).toBeHidden();
	await expect(
		page.getByRole("button", { name: "Open navigation" }),
	).toBeFocused();
});
