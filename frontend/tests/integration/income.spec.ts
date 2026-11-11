import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./base.ts";
import { readSavedServerModel, resetFixture } from "./fixture.ts";
import type { AnalysisFinding } from "../../src/api/generated/model/analysisFinding.ts";

function incomeFixture(readOnly = false) {
	return {
		readOnly,
		bankTransactions: [2, 16, 30].map((day, index) => ({
			id: `payroll-${index}`,
			description: "ACME PAYROLL",
			amount: "2000.00",
			posted: Date.UTC(2026, 0, day) / 1000,
		})),
	};
}

test("the fixture seeds owned editable bank transactions", async () => {
	await resetFixture(incomeFixture());
	const saved = await readSavedServerModel();
	expect(saved.transactions).toContainEqual(
		expect.objectContaining({
			id: expect.any(String),
			name: "ACME PAYROLL",
			sourceAccountId: null,
			destinations: expect.any(Array),
			syncOwned: true,
			readOnly: false,
		}),
	);
});

async function openIncome(page: Page) {
	await expect
		.poll(async () => {
			const data = await (
				await page.request.get("/v1/analysis-findings")
			).json();
			return data.findings.filter(
				(item: { kind: string }) => item.kind === "income",
			).length;
		})
		.toBe(3);
	await page.goto("/sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	return page.getByRole("region", { name: "Payment patterns", exact: true });
}

test("income answers can be corrected and survive refresh without financial mutations", async ({
	page,
}) => {
	await resetFixture(incomeFixture());
	const before = await (await page.request.get("/v1/financial-model")).json();
	let income = await openIncome(page);
	await expect(
		income.getByText("Confirm or correct suggested payment purposes."),
	).toBeVisible();
	await expect(income.getByRole("article")).toHaveCount(1);
	await expect(income.getByText(/2,000 USD typical/)).toBeVisible();
	await expect(income.getByText(/3 recorded/)).toBeVisible();
	const confirm = income
		.getByRole("button", { name: /Confirm income for/ })
		.first();
	await confirm.click();
	await expect(confirm).toBeDisabled();
	await income
		.getByRole("button", { name: /Not income for/ })
		.first()
		.click();
	await expect(
		income.getByRole("button", { name: /Not income for/ }).first(),
	).toBeDisabled();
	await page.reload();
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	income = page.getByRole("region", { name: "Payment patterns", exact: true });
	await expect(
		income.getByRole("button", { name: /Not income for/ }).first(),
	).toBeDisabled();
	await income
		.getByRole("button", { name: /Confirm income for/ })
		.first()
		.click();
	await expect(
		income.getByRole("button", { name: /Confirm income for/ }).first(),
	).toBeDisabled();
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(
		audit.map((event: { request: { action: string } }) => event.request.action),
	).toEqual(["confirm", "reject", "confirm"]);
	expect(audit[0].prediction.judgmentInput.pattern.typicalAmount).toBe(
		"2000.00",
	);
	expect(audit[0].prediction.judgmentInput.id).toBe(
		audit[1].prediction.judgmentInput.id,
	);
	const after = await (await page.request.get("/v1/financial-model")).json();
	expect(after.model).toEqual(before.model);
	expect(after.revision).toBe(before.revision);
	const accessibility = await new AxeBuilder({ page })
		.include('[aria-label="Payment patterns"]')
		.disableRules(["color-contrast"])
		.analyze();
	expect(accessibility.violations).toEqual([]);
});

test("income review remains read-only for readers", async ({ page }) => {
	await resetFixture(incomeFixture(true));
	const income = await openIncome(page);
	await expect(income.getByRole("button")).toHaveCount(0);
});

test("income review keeps its latest answer when a pattern spans findings pages", async ({
	page,
}) => {
	await resetFixture({
		bankTransactions: Array.from({ length: 101 }, (_, index) => ({
			id: `payroll-${index}`,
			description: "ACME PAYROLL",
			amount: "2000.00",
			posted: Date.UTC(2022, 0, 2 + index * 14) / 1000,
		})),
	});
	await expect
		.poll(async () => {
			const status = await (await page.request.get("/v1/analyses")).json();
			return status.analyses.find(
				(item: { type: string }) => item.type === "payments",
			)?.state;
		})
		.toBe("succeeded");
	const first = await (
		await page.request.get("/v1/analysis-findings?limit=100")
	).json();
	const firstIds = new Set(
		first.findings.map((finding: AnalysisFinding) => finding.id),
	);
	const findings: AnalysisFinding[] = [...first.findings];
	let cursor = first.nextCursor;
	while (cursor) {
		const data = await (
			await page.request.get(
				`/v1/analysis-findings?limit=100&cursor=${encodeURIComponent(cursor)}`,
			)
		).json();
		findings.push(...data.findings);
		cursor = data.nextCursor;
	}
	const anchor = findings.find(
		(finding) => finding.kind === "income" && !firstIds.has(finding.id),
	)!;
	expect(anchor).toBeTruthy();
	expect(
		(
			await page.request.post(`/v1/analysis-findings/${anchor.id}/feedback`, {
				data: {
					requestId: crypto.randomUUID(),
					runId: anchor.runId,
					revision: anchor.feedbackRevision,
					action: "reject",
				},
			})
		).ok(),
	).toBe(true);
	await page.goto("/sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	const income = page.getByRole("region", {
		name: "Payment patterns",
		exact: true,
	});
	await expect(income.getByRole("article")).toHaveCount(1);
	await expect(
		income.getByRole("button", { name: /Not income for/ }),
	).toBeDisabled();
	await page
		.getByRole("button", { name: "Next findings", exact: true })
		.click();
	await expect(
		income.getByRole("button", { name: /Not income for/ }),
	).toBeDisabled();
	await income.getByRole("button", { name: /Confirm income for/ }).click();
	await expect(
		income.getByRole("button", { name: /Confirm income for/ }),
	).toBeDisabled();
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(audit.map((event: { findingId: string }) => event.findingId)).toEqual([
		anchor.id,
		anchor.id,
	]);
});
