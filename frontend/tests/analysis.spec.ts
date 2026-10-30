import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetFixture } from "./fixture.ts";

async function seedBNPL(readOnly = false) {
	await resetFixture({
		readOnly,
		bankTransactions: [
			{
				id: "bnpl",
				description: "Klarna Pay in 4 installment",
				amount: "-25",
				posted: Date.UTC(2026, 0, 20) / 1000,
			},
			{
				id: "ordinary",
				description: "PayPal ordinary purchase",
				amount: "-12",
				posted: Date.UTC(2026, 0, 21) / 1000,
			},
		],
	});
}

async function openBNPL(page: Page) {
	await expect
		.poll(
			async () =>
				(await (await page.request.get("/v1/analysis-findings")).json())
					.findings.length,
		)
		.toBe(1);
	await page.goto("/#accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const activity = page.getByRole("dialog", {
		name: "Everyday checking",
		exact: true,
	});
	await activity
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("Klarna");
	await activity.getByRole("button", { name: /View Klarna Pay in 4/ }).click();
	return page.getByRole("dialog", { name: /Klarna Pay in 4/ });
}

test("Yes confirms BNPL, collects total duration, and preserves the financial model", async ({
	page,
}) => {
	await seedBNPL();
	const before = await (await page.request.get("/v1/financial-model")).json();
	let detail = await openBNPL(page);
	const panel = detail.getByRole("region", { name: "Transaction analysis" });
	await expect(
		panel.getByText("Is this a buy now, pay later payment from Klarna?", {
			exact: true,
		}),
	).toBeVisible();
	await expect(panel.locator("ul")).toHaveCount(0);
	await expect(
		panel.getByText(/forecast|recognized provider|repayment/i),
	).toHaveCount(0);
	await panel.getByRole("button", { name: "Yes", exact: true }).click();
	await expect(
		panel.getByText("How long is the plan?", { exact: true }),
	).toBeVisible();
	const count = panel.getByRole("spinbutton", {
		name: "Duration",
		exact: true,
	});
	await expect(count).toBeFocused();
	await count.fill("0");
	await panel.getByRole("button", { name: "Save", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await (await page.request.get("/v1/analysis-feedback")).json())
					.feedback.length,
		)
		.toBe(1);
	await count.fill("6");
	await panel
		.getByRole("combobox", { name: "Unit", exact: true })
		.selectOption("weeks");
	await count.press("Enter");
	await expect(
		panel.getByText("Klarna · 6 weeks", { exact: true }),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Change", exact: true }),
	).toBeFocused();
	await page.reload();
	detail = await openBNPL(page);
	await expect(
		detail.getByText("Klarna · 6 weeks", { exact: true }),
	).toBeVisible();
	await detail.getByRole("button", { name: "Change", exact: true }).click();
	await detail
		.getByRole("spinbutton", { name: "Duration", exact: true })
		.fill("3");
	await detail
		.getByRole("combobox", { name: "Unit", exact: true })
		.selectOption("months");
	await detail.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		detail.getByText("Klarna · 3 months", { exact: true }),
	).toBeVisible();
	await expect(
		detail.getByRole("button", { name: "Change", exact: true }),
	).toBeFocused();
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(
		audit.map((event: { request: { action: string } }) => event.request.action),
	).toEqual(["confirm", "set-duration", "set-duration"]);
	expect(audit[0].review.duration).toBeUndefined();
	expect(audit[1].review.duration).toEqual({ count: 6, unit: "weeks" });
	expect(audit[0].prediction.provider).toBe("klarna");
	expect(audit[0].analyzerVersion).toBeTruthy();
	const after = await (await page.request.get("/v1/financial-model")).json();
	expect(after.revision).toBe(before.revision);
	expect(after.document).toEqual(before.document);
	const results = await new AxeBuilder({ page })
		.disableRules(["color-contrast"])
		.analyze();
	expect(results.violations).toEqual([]);
});

test("No dismisses the prompt and records a negative label", async ({
	page,
}) => {
	await seedBNPL();
	const detail = await openBNPL(page);
	await detail.getByRole("button", { name: "No", exact: true }).click();
	await expect(
		detail.getByRole("region", { name: "Transaction analysis" }),
	).toHaveCount(0);
	await page.reload();
	const reopened = await openBNPL(page);
	await expect(
		reopened.getByRole("region", { name: "Transaction analysis" }),
	).toHaveCount(0);
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(audit).toHaveLength(1);
	expect(audit[0].request.action).toBe("reject");
	expect(audit[0].review.decision).toBe("rejected");
	await page.goto("/#sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	await expect(
		page.getByRole("cell", { name: "Not BNPL", exact: true }),
	).toBeVisible();
});

test("a lost response retries the same answer without duplicate feedback", async ({
	page,
}) => {
	await seedBNPL();
	const detail = await openBNPL(page);
	let first = true;
	const requestIds: string[] = [];
	await page.route("**/v1/analysis-findings/*/feedback", async (route) => {
		requestIds.push(route.request().postDataJSON().requestId);
		if (!first) return route.continue();
		first = false;
		await route.fetch();
		await route.abort("failed");
	});
	await detail.getByRole("button", { name: "Yes", exact: true }).click();
	await expect(
		detail.getByRole("spinbutton", { name: "Duration", exact: true }),
	).toBeVisible();
	await expect.poll(() => requestIds.length).toBe(2);
	expect(requestIds[1]).toBe(requestIds[0]);
	await expect(
		detail.getByRole("spinbutton", { name: "Duration", exact: true }),
	).toBeEnabled();
	await expect(
		detail.getByText("Your answer could not be saved. Try again."),
	).toHaveCount(0);
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(audit).toHaveLength(1);
});

test("read-only users can inspect findings on a narrow screen", async ({
	page,
}) => {
	await seedBNPL(true);
	await page.setViewportSize({ width: 390, height: 844 });
	const detail = await openBNPL(page);
	await expect(detail.getByText("Likely BNPL", { exact: true })).toBeVisible();
	await expect(
		detail.getByRole("button", { name: /^(Yes|No|Change)$/ }),
	).toHaveCount(0);
	await page.goto("/#sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	await expect(page.getByText("Likely BNPL", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /Dismiss flag/ })).toHaveCount(
		0,
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	const result = await new AxeBuilder({ page })
		.disableRules(["color-contrast"])
		.analyze();
	expect(result.violations).toEqual([]);
});
