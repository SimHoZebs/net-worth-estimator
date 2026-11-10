import { expect, test } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

for (const scenario of [
	{
		kind: "schedule-percent",
		label: "Based on schedule",
		reference: "salary",
		from: "",
		to: "savings",
		expression: "base * share",
		requested: 560,
	},
	{
		kind: "account-percent",
		label: "Based on account",
		reference: "checking",
		from: "checking",
		to: "brokerage",
		expression: "base * share",
		requested: 392,
	},
	{
		kind: "investment-growth",
		label: "Balance to grow",
		reference: "brokerage",
		from: "",
		to: "brokerage",
		expression: "base * rate",
		// Projection event output rounds currency to whole dollars.
		requested: 117,
	},
	{
		kind: "owed-balance",
		label: "Debt account",
		reference: "loan",
		from: "checking",
		to: "loan",
		expression: "(abs(balance) - balance) / 2",
		requested: 18000,
	},
]) {
	test(`creates and projects ${scenario.kind} through the ordinary schedule API`, async ({
		page,
		request,
	}) => {
		await page.goto("/transactions?editor=schedule&id=new");
		const dialog = page.getByRole("dialog", { name: "Add schedule" });
		await dialog.getByLabel("Schedule name").fill("Guided rule");
		await dialog
			.getByLabel("How is the amount calculated?")
			.selectOption(scenario.kind);
		await dialog.getByLabel(scenario.label).selectOption(scenario.reference);
		await dialog
			.getByLabel("From", { exact: true })
			.selectOption(scenario.from);
		await dialog.getByLabel("To", { exact: true }).selectOption(scenario.to);
		await dialog.getByLabel("First occurrence").fill("2026-02-02");
		await dialog
			.getByText("Limits and execution order", { exact: true })
			.click();
		await dialog.getByLabel("Annual cap (USD)").fill("23000");
		await dialog
			.getByRole("button", { name: "Add schedule", exact: true })
			.click();
		await expect(dialog).not.toBeVisible();
		const { model } = await (
			await request.get(`${FIXTURE_API}/v1/financial-model`)
		).json();
		const saved = model.schedules.find(
			(entry: { name: string }) => entry.name === "Guided rule",
		);
		expect(saved.amount.config.expression).toBe(scenario.expression);
		expect(saved.annualCap).toBe(23000);
		expect(saved.priority).toBe(scenario.kind === "schedule-percent" ? 5 : 9);
		const projection = await request.post(
			`${FIXTURE_API}/v1/projections/deterministic`,
			{
				data: {
					model,
					settings: {
						fallbackProjectionStartDate: "2026-01-31",
						horizonYears: 1,
						evaluations: model.evaluations,
					},
					range: { startDate: "2026-01-31", endDate: "2026-04-01" },
				},
			},
		);
		expect(projection.ok(), await projection.text()).toBe(true);
		const projected = await projection.json();
		expect(projected.error).toBeUndefined();
		expect(projected.result).toBeTruthy();
		const first = projected.result.transactionEvents.find(
			(event: { origin: { transactionId: string } }) =>
				event.origin.transactionId === saved.id,
		);
		expect(first).toBeTruthy();
		expect(Number.isFinite(first.requestedAmount)).toBe(true);
		expect(first.requestedAmount).toBeCloseTo(scenario.requested, 2);
		await page.reload();
		const { model: reloaded } = await (
			await request.get(`${FIXTURE_API}/v1/financial-model`)
		).json();
		expect(
			reloaded.schedules.find((entry: { id: string }) => entry.id === saved.id),
		).toEqual(saved);
	});
}

for (const priority of ["", "0", "12"]) {
	test(`fixed schedules preserve ${priority === "" ? "server append order" : `explicit priority ${priority}`}`, async ({
		page,
		request,
	}) => {
		await page.goto("/transactions?editor=schedule&id=new");
		const dialog = page.getByRole("dialog", { name: "Add schedule" });
		await dialog.getByLabel("Schedule name").fill("Bill after payroll");
		await dialog.getByLabel("Amount (USD)").fill("9000");
		await dialog.getByLabel("From", { exact: true }).selectOption("checking");
		await dialog.getByLabel("First occurrence").fill("2026-02-01");
		await dialog
			.getByText("Limits and execution order", { exact: true })
			.click();
		await dialog.getByLabel("Execution priority").fill(priority);
		await dialog
			.getByRole("button", { name: "Add schedule", exact: true })
			.click();
		await expect(dialog).not.toBeVisible();
		const { model } = await (
			await request.get(`${FIXTURE_API}/v1/financial-model`)
		).json();
		const saved = model.schedules.find(
			(entry: { name: string }) => entry.name === "Bill after payroll",
		);
		expect(saved.priority).toBe(priority === "" ? 9 : Number(priority));
		const projection = await request.post(
			`${FIXTURE_API}/v1/projections/deterministic`,
			{
				data: {
					model,
					settings: {
						fallbackProjectionStartDate: "2026-01-31",
						horizonYears: 1,
						evaluations: model.evaluations,
					},
					range: { startDate: "2026-01-31", endDate: "2026-02-02" },
				},
			},
		);
		expect(projection.ok(), await projection.text()).toBe(true);
		const { result } = await projection.json();
		const payment = result.transactionEvents.find(
			(event: { origin: { transactionId: string } }) =>
				event.origin.transactionId === saved.id,
		);
		expect(payment.requestedAmount).toBe(9000);
		expect(payment.realizedAmount).toBe(priority === "0" ? 4200 : 9000);
	});
}

test("preserves inputs across recipe changes and rejects a missing reference", async ({
	page,
}) => {
	await page.goto("/transactions?editor=schedule&id=new");
	const dialog = page.getByRole("dialog", { name: "Add schedule" });
	await dialog.getByLabel("Schedule name").fill("My transfer");
	await dialog.getByLabel("To", { exact: true }).selectOption("brokerage");
	await dialog.getByLabel("Amount (USD)").fill("725");
	await dialog
		.getByLabel("How is the amount calculated?")
		.selectOption("schedule-percent");
	await dialog.getByLabel("Percentage (%)").fill("12.5");
	await dialog
		.getByRole("button", { name: "Add schedule", exact: true })
		.click();
	await expect(dialog).toBeVisible();
	expect(
		await dialog
			.getByLabel("Based on schedule")
			.evaluate(
				(element) => (element as HTMLSelectElement).validity.valueMissing,
			),
	).toBe(true);
	await dialog
		.getByLabel("How is the amount calculated?")
		.selectOption("fixed");
	await expect(dialog.getByLabel("Amount (USD)")).toHaveValue("725");
	await dialog
		.getByLabel("How is the amount calculated?")
		.selectOption("schedule-percent");
	await expect(dialog.getByLabel("Percentage (%)")).toHaveValue("12.5");
	await dialog.getByLabel("Based on schedule").selectOption("salary");
	await dialog.getByRole("button", { name: "Use source timing" }).click();
	await expect(dialog.getByLabel("First occurrence")).toHaveValue("2026-02-01");
	await expect(dialog.getByLabel("Frequency", { exact: true })).toHaveValue(
		"monthly",
	);
});

test("keeps calculated references on a rename", async ({ page, request }) => {
	const created = await request.post(`${FIXTURE_API}/v1/schedules`, {
		data: {
			name: "Employer match",
			sourceAccountId: undefined,
			destinations: ["savings"],
			amount: {
				resolver: "expression",
				config: { expression: "base * share" },
				inputs: {
					base: {
						source: "provider",
						provider: "model-value",
						arguments: { id: "savings_contribution" },
					},
					share: { source: "literal", value: 0.5 },
				},
			},
			frequency: "monthly",
			startDate: "2026-02-12",
			priority: 7,
			enabled: true,
		},
	});
	expect(created.ok()).toBe(true);
	const { value: saved, saved: didSave } = await created.json();
	expect(didSave).toBe(true);
	await page.goto(`/transactions?editor=transaction&id=${saved.id}`);
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Transaction name").fill("Renamed match");
	await dialog.getByRole("button", { name: "Save changes" }).click();
	await expect(dialog).not.toBeVisible();
	const { model } = await (
		await request.get(`${FIXTURE_API}/v1/financial-model`)
	).json();
	const renamed = model.schedules.find(
		(entry: { id: string }) => entry.id === saved.id,
	);
	expect(renamed.name).toBe("Renamed match");
	expect(renamed.amount).toEqual(saved.amount);
});
