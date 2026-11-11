import { expect, test } from "./base.ts";
import { resetFixture } from "./fixture.ts";

test("rent shares income review without changing financial rows", async ({
	page,
}) => {
	await resetFixture({
		bankTransactions: [
			...[0, 1, 2].map((month) => ({
				id: `rent-${month}`,
				description: "BILT RENT",
				amount: "-1800.00",
				posted: Date.UTC(2026, month, 2) / 1000,
			})),
			...[0, 1, 2].map((month) => ({
				id: `card-${month}`,
				description: "BILT CARD PAYMENT",
				amount: "-800.00",
				posted: Date.UTC(2026, month, 2) / 1000,
			})),
			...[2, 16, 30].map((day) => ({
				id: `payroll-${day}`,
				description: "ACME PAYROLL",
				amount: "2000.00",
				posted: Date.UTC(2026, 0, day) / 1000,
			})),
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
		.toBe(3);
	const before = await (await page.request.get("/v1/financial-model")).json();
	await page.goto("/sources");
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	const patterns = page.getByRole("region", {
		name: "Pattern review",
		exact: true,
	});
	await expect(
		patterns.getByRole("button", { name: "Review BILT RENT" }),
	).toBeVisible();
	await expect(
		patterns.getByRole("button", { name: "Review ACME PAYROLL" }),
	).toBeVisible();
	await expect(
		patterns.getByRole("button", { name: "Review BILT CARD PAYMENT" }),
	).toBeVisible();
	await expect(patterns.getByText(/1,800 USD typical/)).toBeVisible();
	await patterns.getByRole("button", { name: "Review BILT RENT" }).click();
	const rentDialog = page.getByRole("dialog", { name: "BILT RENT" });
	await rentDialog.getByRole("button", { name: /Confirm rent for/ }).click();
	await expect(
		rentDialog.getByRole("button", { name: /Confirm rent for/ }),
	).toBeDisabled();
	await rentDialog.getByRole("button", { name: "Close dialog" }).click();
	await patterns.getByRole("button", { name: "Review ACME PAYROLL" }).click();
	const incomeDialog = page.getByRole("dialog", { name: "ACME PAYROLL" });
	await expect(
		incomeDialog.getByRole("button", { name: /Confirm income for/ }),
	).toBeEnabled();
	await incomeDialog.getByRole("button", { name: "Close dialog" }).click();
	await page.reload();
	await page.getByRole("tab", { name: "Analysis", exact: true }).click();
	await patterns.getByRole("tab", { name: "Saved (1)" }).click();
	await patterns.getByRole("button", { name: "Review BILT RENT" }).click();
	const savedDialog = page.getByRole("dialog", { name: "BILT RENT" });
	await savedDialog.getByRole("button", { name: /Not rent for/ }).click();
	await expect(
		savedDialog.getByRole("button", { name: /Not rent for/ }),
	).toBeDisabled();
	const audit = (await (await page.request.get("/v1/analysis-feedback")).json())
		.feedback;
	expect(
		audit.map(
			(event: { prediction: { judgmentInput: { kind: string } } }) =>
				event.prediction.judgmentInput.kind,
		),
	).toEqual(["rent", "rent"]);
	const after = await (await page.request.get("/v1/financial-model")).json();
	expect(after.model).toEqual(before.model);
	expect(after.revision).toBe(before.revision);
});
