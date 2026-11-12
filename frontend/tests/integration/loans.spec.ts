import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

test("account type changes fields inline and keeps shared identity controls", async ({
	page,
}) => {
	await page.goto("/accounts");
	await page.getByRole("button", { name: "Add account", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add account", exact: true });
	const type = dialog.getByLabel("Account type");
	const name = dialog.getByLabel("Account name");
	const included = dialog.getByLabel("Include in net worth and projections");
	await name.fill("Education debt");
	await included.uncheck();
	await type.click();
	await expect(
		dialog.getByRole("option", { name: "Debt", exact: true }).locator("svg"),
	).toBeVisible();
	await expect(
		dialog.getByRole("option", { name: "Debt", exact: true }),
	).toHaveCount(1);
	await expect(dialog.getByRole("option")).toHaveCount(4);
	await dialog.getByRole("option", { name: "Debt", exact: true }).click();
	await expect(type).toContainText("Debt");
	await expect(type.locator("svg").first()).toBeVisible();
	await expect(
		dialog.getByLabel("Principal (USD)", { exact: true }),
	).toBeVisible();
	await expect(dialog.getByLabel("Balance (USD)", { exact: true })).toHaveCount(
		0,
	);
	await expect(included).not.toBeChecked();
	await type.click();
	await dialog
		.getByRole("option", { name: "Cash & savings", exact: true })
		.click();
	await expect(
		dialog.getByLabel("Balance (USD)", { exact: true }),
	).toBeVisible();
	await expect(name).toHaveValue("Education debt");
	await type.click();
	await dialog.getByRole("option", { name: "Debt", exact: true }).click();
	await name.fill("");
	await dialog
		.getByRole("button", { name: "Add account", exact: true })
		.click();
	await expect(name).toBeFocused();
	expect(
		await name.evaluate(
			(input: HTMLInputElement) => input.validity.valueMissing,
		),
	).toBe(true);
	await expect(dialog).toBeVisible();
});

test("ordinary debt accounts edit payment terms with save and remove", async ({
	page,
	request,
}) => {
	await page.goto("/accounts");
	await page
		.getByRole("button", {
			name: "Open Student loan transactions",
			exact: true,
		})
		.click();
	const details = page.getByRole("region", { name: "Account details" });
	await details.getByRole("tab", { name: "Account details" }).click();
	const terms = details.getByRole("region", { name: "Payment terms" });
	await expect(terms.getByLabel("Minimum payment in USD")).toBeVisible();
	await terms.getByLabel("Minimum payment in USD").fill("25");
	await terms.getByLabel("Minimum percent of the balance").fill("2");
	await terms.getByLabel("Due day of the month").fill("15");
	await terms.getByLabel("Statement day of the month, optional").fill("20");
	await terms.getByRole("button", { name: "Save payment terms" }).click();
	await expect
		.poll(
			async () =>
				(await (await request.get(`${FIXTURE_API}/v1/financial-model`)).json())
					.model.paymentTerms ?? [],
			{ timeout: 10_000 },
		)
		.toEqual([
			{
				accountId: "loan",
				minimumFixed: 25,
				minimumPercent: 0.02,
				dueDay: 15,
				statementDay: 20,
			},
		]);
	await terms.getByRole("button", { name: "Remove" }).click();
	await expect
		.poll(
			async () =>
				(await (await request.get(`${FIXTURE_API}/v1/financial-model`)).json())
					.model.paymentTerms ?? [],
			{ timeout: 10_000 },
		)
		.toEqual([]);
	await expect(terms.getByLabel("Minimum payment in USD")).toHaveValue("");
});

test("one debt form creates one visible account and preserves terms on edit", async ({
	page,
	request,
}) => {
	await page.goto("/accounts");
	await page.getByRole("button", { name: "Add account", exact: true }).click();
	const form = page.getByRole("dialog", { name: "Add account", exact: true });
	await form.getByLabel("Account name").fill("Education debt");
	const type = form.getByLabel("Account type");
	await type.click();
	await form.getByRole("option", { name: "Debt", exact: true }).click();
	await expect(type).toBeFocused();
	await expect(page.getByRole("dialog")).toHaveCount(1);
	await expect(form.getByLabel("Account name")).toHaveValue("Education debt");
	await expect(
		form.getByRole("button", { name: "add a loan", exact: true }),
	).toHaveCount(0);
	await form.getByLabel("Principal (USD)", { exact: true }).fill("12000");
	await form.getByLabel("Accrued interest (USD)").fill("237.54");
	await form.getByLabel("Annual interest rate (%)").fill("3.99");
	await form.getByLabel("Payment amount (USD)").fill("91.08");
	await form
		.getByLabel("Pay from")
		.selectOption({ label: "Everyday checking" });
	await expect(
		form.getByLabel("Pay from").locator("selectedcontent svg"),
	).toBeVisible();
	const lastField = await form.getByLabel("First payment").boundingBox();
	const actions = await form
		.getByRole("button", { name: "Add account", exact: true })
		.boundingBox();
	expect(lastField).not.toBeNull();
	expect(actions).not.toBeNull();
	expect(actions!.y - (lastField!.y + lastField!.height)).toBeLessThan(100);
	await form.getByLabel("First interest charge").fill("2026-02-13");
	await form.getByLabel("First payment").fill("2026-02-13");
	await expect(form.getByText("$12,237.54", { exact: true })).toBeVisible();
	expect(
		(await new AxeBuilder({ page }).include("dialog[open]").analyze())
			.violations,
	).toEqual([]);
	await form.getByRole("button", { name: "Add account", exact: true }).click();
	await expect(form).toBeHidden();
	await expect(
		page.getByRole("button", {
			name: "Open Education debt transactions",
			exact: true,
		}),
	).toHaveCount(1);
	await expect(
		page.getByText("Education debt (Interest)", { exact: true }),
	).toHaveCount(0);
	const response = await request.get(`${FIXTURE_API}/v1/financial-model`);
	const saved = (await response.json()).model;
	const primary = saved.accounts.find(
		(a: { display?: { components?: unknown[] } }) =>
			(a.display?.components?.length ?? 0) > 1,
	);
	expect(primary.display.components).toHaveLength(2);
	expect(
		saved.schedules.find(
			(r: { id: string }) => r.id === primary.display.paymentScheduleId,
		).destinations,
	).toEqual([primary.display.components[1].accountId, primary.id]);
	const adjustmentRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/balance-adjustments"))
			adjustmentRequests.push(request.url());
	});
	await page
		.getByRole("button", {
			name: "Open Education debt transactions",
			exact: true,
		})
		.click();
	const details = page.getByRole("region", { name: "Account details" });
	await expect(details.getByLabel("Account name")).toHaveAttribute(
		"readonly",
		"",
	);
	await expect(details.getByLabel("Balance (USD)")).toHaveAttribute(
		"readonly",
		"",
	);
	await expect(details.getByText("Loading balance adjustments…")).toHaveCount(
		0,
	);
	await details.getByRole("tab", { name: "Account details" }).click();
	await expect(
		details.getByRole("button", { name: "Edit debt and payment terms" }),
	).toBeEnabled();
	expect(adjustmentRequests).toEqual([]);
	await details
		.getByRole("button", { name: "Edit debt and payment terms" })
		.click();
	const edit = page.getByRole("dialog", {
		name: "Edit Education debt",
		exact: true,
	});
	await expect(edit.getByLabel("Annual interest rate (%)")).toHaveValue("3.99");
	await edit.getByLabel("Annual interest rate (%)").fill("4.5");
	await edit.getByRole("button", { name: "Save account", exact: true }).click();
	await expect(edit).toBeHidden();
	const after = (
		await (await request.get(`${FIXTURE_API}/v1/financial-model`)).json()
	).model;
	expect(after.checkpoints).toEqual(saved.checkpoints);
	await details.getByRole("tab", { name: "Account details" }).click();
	await expect(
		details.getByText("$12,000.00", { exact: true }).first(),
	).toBeVisible();
	await expect(
		details.getByText("$237.54", { exact: true }).first(),
	).toBeVisible();
	await page
		.getByRole("navigation", { name: "Breadcrumb" })
		.getByRole("button", { name: "Accounts" })
		.click();
	await page
		.getByRole("button", { name: "Remove Education debt", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Remove account", exact: true })
		.click();
	await expect(
		page.getByRole("button", {
			name: "Open Education debt transactions",
			exact: true,
		}),
	).toHaveCount(0);
	const deleted = (
		await (await request.get(`${FIXTURE_API}/v1/financial-model`)).json()
	).model;
	expect(
		deleted.accounts.some((a: { id: string }) =>
			primary.display.components.some(
				(c: { accountId: string }) => c.accountId === a.id,
			),
		),
	).toBe(false);
});
