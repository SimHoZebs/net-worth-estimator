import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
	REMOTE_STORAGE_KEY,
	readSavedServerPlan,
	readTemporaryVersion,
	resetFixture,
} from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

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

test("outlook renders real calculations, scenario ranges, evidence and exact chart values", async ({
	page,
}) => {
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
	// The headline is compact; the exact figure is behind the values table.
	await expect(page.getByText("$1.02M")).toBeVisible();
	await expect(page.getByText(/80% of 400 scenarios/)).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Inspect this expense" }).click();
	await expect(page.getByRole("dialog")).toContainText(
		"Protected account balance",
	);
	await expect(page.getByRole("dialog")).toContainText("Mar 6, 2026");
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Inspect this expense" }),
	).toBeFocused();
	await page
		.getByRole("button", { name: "View exact projection values" })
		.click();
	await expect(page.getByRole("table")).toContainText("$1,016,195");
	await page.getByRole("button", { name: "10 years", exact: true }).click();
	await expect(page.getByText("Base case in 2036")).toBeVisible();
	expect(errors).toEqual([]);
});

test("edits remain temporary, persist across reload, compare, and save deliberately", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Try a change", exact: true }).click();
	await page.getByLabel("Amount (USD)").fill("900");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await expect(page.getByText("Exploring a temporary version")).toBeVisible();
	await page.reload();
	await expect(
		page.getByText("1 unsaved change · saved server plan unchanged"),
	).toBeVisible();
	await page.getByRole("button", { name: "Review & save" }).click();
	await expect(
		page.getByRole("heading", { name: "Your changes" }),
	).toBeVisible();
	await page.getByText("Monthly investing", { exact: true }).click();
	await expect(page.getByText("$600", { exact: true })).toBeVisible();
	await expect(page.getByText("$900", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Save this plan" }).click();
	await expect(page.getByText("No unsaved changes.")).toBeVisible();
	await page.reload();
	// The save reached the server, and the temporary version is gone.
	const saved = await readSavedServerPlan();
	expect(
		saved.postings.find((posting) => posting.id === "invest")?.amount.config
			.expression,
	).toBe("900");
	expect(await readTemporaryVersion(page)).toBeNull();
});

test("discard is explicit and restores the saved plan", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Try a change", exact: true }).click();
	await page.getByLabel("Amount (USD)").fill("999");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText(
		"Return to your saved plan?",
	);
	await page.getByRole("button", { name: "Keep exploring" }).click();
	await expect(page.getByText("Exploring a temporary version")).toBeVisible();
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	await page
		.getByRole("button", { name: "Discard changes", exact: true })
		.click();
	await expect(
		page.getByText("Exploring a temporary version"),
	).not.toBeVisible();
});

test("account, movement and goal maintenance plus search work", async ({
	page,
}) => {
	await page.goto("/#plan");
	await page.getByRole("button", { name: "Add account" }).click();
	await page.getByLabel("Account name").fill("Travel savings");
	await page.getByLabel("Balance (USD)", { exact: true }).fill("2500");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await page.getByRole("textbox", { name: "Search plan" }).fill("Travel");
	await expect(page.getByRole("row", { name: /Travel savings/ })).toBeVisible();
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await page.getByRole("button", { name: "Add goal", exact: true }).click();
	await page.getByLabel("Goal name").fill("Next big trip");
	await page.getByLabel("Measure", { exact: true }).selectOption("reserve");
	await page
		.getByLabel("Account", { exact: true })
		.selectOption({ label: "Travel savings" });
	await page.getByLabel("Target (USD)").fill("5000");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await expect(
		page.getByRole("heading", { name: "Next big trip" }),
	).toBeVisible();
});

test("invalid imports and failed saves retain the intended plan", async ({
	page,
}) => {
	await page.goto("/#sources");
	await page.getByLabel("Import Waypoint server model").setInputFiles({
		name: "broken.json",
		mimeType: "application/json",
		buffer: Buffer.from("{wrong"),
	});
	await expect(page.getByRole("alert")).toContainText("not valid JSON");
	// A rejected import leaves the loaded plan in place.
	await expect(page.getByLabel("Import Waypoint server model")).toBeVisible();
	await page.getByRole("link", { name: "Outlook", exact: true }).click();
	await page.getByRole("button", { name: "Try a change", exact: true }).click();
	await page.getByLabel("Amount (USD)").fill("900");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await page.getByRole("button", { name: "Review & save" }).click();
	// The server rejects the write, so the temporary version must survive.
	await page.route("**/v1/financial-model", async (route) => {
		if (route.request().method() === "PUT")
			return route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ error: "injected failure" }),
			});
		return route.continue();
	});
	await page.getByRole("button", { name: "Save this plan" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "HTTP 500" }),
	).toBeVisible();
	await expect(page.getByText("Exploring a temporary version")).toBeVisible();
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
	// The remote workspace key holds the temporary version. Corrupt it and the
	// app must surface a recovery path rather than invent a plan.
	await page.addInitScript((key) => {
		window.localStorage.setItem(key, "invalid");
	}, REMOTE_STORAGE_KEY);
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
	for (const path of ["/", "/#plan", "/#goals", "/#compare", "/#sources"]) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze();
		expect(issues(results.violations), path).toEqual([]);
	}
	await page.goto("/");
	await page.getByRole("button", { name: "Try a change", exact: true }).click();
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
		.analyze();
	expect(issues(results.violations)).toEqual([]);
});

test("mobile navigation, evidence and layouts stay usable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	for (const { route, label } of [
		{ route: "plan", label: "Your plan" },
		{ route: "sources", label: "Data & sources" },
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
		await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
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
	await page.getByRole("link", { name: "Your plan", exact: true }).click();
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
				class: element.className,
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
	await page.getByText(/80% of 400 scenarios/).waitFor({ timeout: 30_000 });
	await page.screenshot({
		path: "test-results/waypoint-mobile.png",
		fullPage: true,
	});
});

test("capture the completed desktop outlook", async ({ page }) => {
	await page.goto("/");
	await page.getByText(/80% of 400 scenarios/).waitFor({ timeout: 30_000 });
	await page.screenshot({
		path: "test-results/waypoint-desktop.png",
		fullPage: true,
	});
});

test("scenario failures expose a recovery action without inventing a range", async ({
	page,
}) => {
	// Server mode streams the range over SSE, so failing the stream is the
	// equivalent of a worker that cannot start.
	await page.route("**/v1/projections/stochastic", (route) => route.abort());
	await page.goto("/");
	await expect(page.getByRole("alert")).toContainText("The API request failed");
	await expect(
		page.getByRole("button", { name: "Retry scenario calculation" }),
	).toBeVisible();
	await expect(
		page.getByText("Range unavailable", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Range unavailable · base case shown"),
	).toBeVisible();
	await expect(page.getByText("$1.02M")).toBeVisible();
	await expect(
		page.getByText("Modeling scenarios", { exact: false }),
	).not.toBeVisible();
});

test("read-only plans can be explored but not saved", async ({ page }) => {
	await resetFixture({ readOnly: true });
	await page.goto("/#sources");
	await expect(page.getByText(/read-only|read only/i).first()).toBeVisible();
	await page.getByRole("link", { name: "Outlook", exact: true }).click();
	await page.getByRole("button", { name: "Try a change", exact: true }).click();
	await page.getByLabel("Amount (USD)").fill("900");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	// The temporary version is allowed; saving it back to the source is not.
	await expect(page.getByText("Exploring a temporary version")).toBeVisible();
	await page.getByRole("button", { name: "Review & save" }).click();
	await expect(
		page.getByRole("button", { name: "Save this plan" }),
	).toBeDisabled();
});

test("comparison snapshots contain measures and exports remain portable", async ({
	page,
}) => {
	await page.goto("/#compare");
	await page.getByRole("button", { name: "Capture snapshot" }).click();
	await expect(
		page.getByText("Captured snapshot", { exact: true }),
	).toBeVisible();
	// The snapshot lives in this browser and carries measures, not a plan.
	const snapshot = await page.evaluate(
		(key) => JSON.parse(window.localStorage.getItem(key)!).snapshot,
		REMOTE_STORAGE_KEY,
	);
	expect(snapshot).not.toHaveProperty("accounts");
	expect(snapshot).not.toHaveProperty("movements");
	expect(snapshot).toHaveProperty("final");
	await page.getByRole("link", { name: "Data & sources", exact: true }).click();
	const file = page.waitForEvent("download");
	await page.getByRole("button", { name: "Export server model" }).click();
	expect((await file).suggestedFilename()).toBe("waypoint-server-model.json");
});

test("a second tab cannot overwrite newer financial work", async ({
	page,
	context,
}) => {
	await page.goto("/");
	const other = await context.newPage();
	await other.goto("/");
	await other
		.getByRole("button", { name: "Try a change", exact: true })
		.click();
	await other.getByLabel("Amount (USD)").fill("1200");
	await other
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await page.getByRole("button", { name: "Try a change", exact: true }).click();
	await page.getByLabel("Amount (USD)").fill("1300");
	await page
		.getByRole("button", { name: "Apply to temporary version" })
		.click();
	await expect(page.getByRole("alert")).toContainText("another tab");
	const stored = await page.evaluate(
		(key) => JSON.parse(window.localStorage.getItem(key)!),
		REMOTE_STORAGE_KEY,
	);
	// The newer write from the other tab is what survives.
	expect(
		stored.draft.movements.find(
			(movement: { id: string }) => movement.id === "invest",
		).amount,
	).toBe(1200);
	await other.close();
});

test("tabs use arrow-key navigation and all main pages fit narrow screens", async ({
	page,
}) => {
	await page.goto("/#plan");
	await expect(
		page.locator('.page-tabs[role="tablist"] > button[role="tab"]'),
	).toHaveCount(4);
	await page.getByRole("tab", { name: /Accounts/ }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("tab", { name: /Movements/ })).toBeFocused();
	await expect(page.getByRole("tab", { name: /Movements/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("End");
	await expect(page.getByRole("tab", { name: "Assumptions" })).toBeFocused();
	for (const width of [320, 768, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		for (const route of ["outlook", "plan", "goals", "compare", "sources"]) {
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
		"Inspect this expense",
		"Inspect next 30 days",
	]) {
		await page.getByRole("button", { name: action, exact: true }).click();
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
		page.getByRole("button", { name: "Open navigation" }),
	).toBeFocused();
});
