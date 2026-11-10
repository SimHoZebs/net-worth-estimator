import { expect, test } from "./base.ts";
import { resetFixture } from "./fixture.ts";

test("a repeating payment becomes a forecast schedule without separate confirmation", async ({
	page,
}, testInfo) => {
	await resetFixture({
		bankTransactions: [0, 1, 2].map((month) => ({
			id: `streamflix-${month}`,
			description: "Streamflix subscription",
			amount: "-30.00",
			posted: Date.UTC(2026, month, 15, 12) / 1000,
		})),
	});
	await expect
		.poll(async () => {
			const body = await (
				await page.request.get("/v1/analysis-findings")
			).json();
			return body.findings.filter(
				(finding: { kind: string }) => finding.kind === "recurring",
			).length;
		})
		.toBe(3);
	await page.goto("/accounts");
	await page
		.getByRole("button", { name: "Open Everyday checking transactions" })
		.click();
	const activity = page.getByRole("region", { name: "Account details" });
	await activity
		.getByRole("searchbox", { name: "Search account transactions" })
		.fill("Streamflix");
	await activity
		.getByRole("button", { name: /View Streamflix subscription/ })
		.first()
		.click();
	const detail = page.getByRole("dialog", { name: /Streamflix subscription/ });
	await detail.getByRole("button", { name: /Review .* suggestion/ }).click();
	const suggestions = page.getByRole("dialog", {
		name: "Suggestions",
		exact: true,
	});
	await expect(
		suggestions.getByRole("button", { name: "Yes", exact: true }),
	).toHaveCount(0);
	await expect(
		suggestions.getByRole("button", { name: "Not repeating", exact: true }),
	).toBeVisible();
	await suggestions
		.getByRole("button", { name: /Create forecast schedule for/ })
		.click();
	const plan = page.getByRole("dialog", { name: /Forecast plan for/ });
	await expect(
		plan.getByRole("button", { name: "Create forecast schedule", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("recurring-forecast-preview.png"),
	});
	await plan.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		suggestions.getByRole("button", { name: /Create forecast schedule for/ }),
	).toBeFocused();
	await suggestions
		.getByRole("button", { name: /Create forecast schedule for/ })
		.click();
	await plan
		.getByRole("button", { name: "Create forecast schedule", exact: true })
		.click();
	await expect(plan.getByRole("status")).toContainText(
		/Forecast schedule .* created/,
	);
	await page.screenshot({
		path: testInfo.outputPath("recurring-forecast-created.png"),
	});
	await plan.getByRole("button", { name: "Close", exact: true }).click();
	await expect(suggestions.getByText("All caught up")).toBeVisible();
});
