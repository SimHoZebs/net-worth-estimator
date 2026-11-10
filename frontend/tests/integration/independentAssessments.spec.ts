import { expect, test } from "./base.ts";
import { readSavedServerModel, resetFixture } from "./fixture.ts";

test("a rent purpose can exist without repetition or an annual estimate", async ({
	page,
}) => {
	await resetFixture({
		bankTransactions: [
			{
				id: "one-rent",
				description: "LANDLORD RENT",
				amount: "-1800.00",
				posted: Date.UTC(2026, 0, 2) / 1000,
			},
		],
	});
	await expect
		.poll(async () => {
			const data = await (
				await page.request.get("/v1/analysis-findings")
			).json();
			return data.findings.filter((f: { kind: string }) => f.kind === "rent")
				.length;
		})
		.toBe(1);
	await page.goto("/sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	const region = page.getByRole("region", {
		name: "Payment patterns",
		exact: true,
	});
	const before = await readSavedServerModel();
	await expect(region.getByText(/Repetition not established/)).toBeVisible();
	await expect(
		region.getByRole("cell", { name: "Not established", exact: true }),
	).toBeVisible();
	await region.getByRole("button", { name: /Confirm rent for/ }).click();
	await expect(
		region.getByRole("button", { name: /Confirm rent for/ }),
	).toBeDisabled();
	const data = await (await page.request.get("/v1/analysis-findings")).json();
	expect(
		data.findings.some((f: { kind: string }) => f.kind === "recurring"),
	).toBe(false);
	expect(await readSavedServerModel()).toEqual(before);
});

test("purpose and repetition share evidence but retain separate answers", async ({
	page,
}) => {
	await resetFixture({
		bankTransactions: [0, 1, 2].map((month) => ({
			id: `rent-${month}`,
			description: "BILT RENT",
			amount: "-1800.00",
			posted: Date.UTC(2026, month, 2) / 1000,
		})),
	});
	await expect
		.poll(async () => {
			const data = await (
				await page.request.get("/v1/analysis-findings")
			).json();
			return data.findings.length;
		})
		.toBe(6);
	await page.goto("/sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	const payments = page.getByRole("region", {
		name: "Payment patterns",
		exact: true,
	});
	const before = await readSavedServerModel();
	await payments.getByRole("button", { name: /Confirm rent for/ }).click();
	await payments.locator("summary").click();
	const repetition = page.getByRole("region", {
		name: /Repetition assessment for/,
	});
	await repetition
		.getByRole("button", { name: /Reject repeating pattern for/ })
		.click();
	await expect(
		payments.getByRole("button", { name: /Confirm rent for/ }),
	).toBeDisabled();
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(
		audit.map((f: { prediction: { kind: string } }) => f.prediction.kind),
	).toEqual(["rent", "recurring"]);
	const data = await (await page.request.get("/v1/analysis-findings")).json();
	expect(
		new Set(data.findings.map((f: { streamId: string }) => f.streamId)).size,
	).toBe(1);
	expect(await readSavedServerModel()).toEqual(before);
});
