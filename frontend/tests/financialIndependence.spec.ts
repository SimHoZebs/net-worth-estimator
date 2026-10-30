import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, test } from "@playwright/test";
import type {
	FinancialModelResponse,
	JsonValue,
} from "../src/api/contracts.ts";
import { FIXTURE_API, resetFixture } from "./fixture.ts";

test.beforeEach(async () => {
	await resetFixture();
});

async function addIndependence(
	request: APIRequestContext,
	overrides: Record<string, JsonValue> = {},
) {
	const response = await request.post(`${FIXTURE_API}/v1/evaluations`, {
		data: {
			type: "financialIndependence",
			instanceId: "visual-independence",
			name: "Financial independence",
			enabled: true,
			config: {
				minimumNetWorth: 0,
				annualExpenseTarget: 80000,
				annualExpenseGrowthRate: 0.025,
				withdrawalRate: 0.04,
				evaluationYears: 10,
				requiredConfidence: 0.9,
				principalPolicy: "preserve-real-principal",
				annualExpenseTargetBasis: "fi-date-dollars",
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
				continuingPostingIds: ["brokerage_growth"],
				...overrides,
			},
		},
	});
	expect(response.ok()).toBe(true);
	const body = await response.json();
	expect(body.persisted).toBe(true);
	return body.row.instanceId as string;
}

test("compact financial independence cards open an inspector without more calculations or card growth", async ({
	page,
	request,
}) => {
	const id = await addIndependence(request);
	let projections = 0;
	page.on("request", (request) => {
		if (/\/v1\/projections\/(deterministic|stochastic)$/.test(request.url()))
			projections++;
	});
	await page.goto("/#evaluations");
	const card = page.getByRole("region", {
		name: "Financial independence",
		exact: true,
	});
	await expect(card.getByText("Not reached", { exact: true })).toBeVisible();
	await expect(
		card.getByRole("button", { name: /Inspect evidence/ }),
	).toHaveCount(0);
	await expect(card.getByRole("slider")).toHaveCount(0);
	await expect(card.getByRole("table")).toHaveCount(0);
	await expect(card.getByText(/reached independence/)).toHaveCount(0);
	const initialHeight = (await card.boundingBox())!.height;
	expect(initialHeight).toBeLessThan(500);
	const count = projections;
	const opener = card.getByRole("button", {
		name: "Inspect independence for Financial independence",
	});
	await opener.click();
	const dialog = page.getByRole("dialog", {
		name: "Financial independence",
		exact: true,
	});
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("tab")).toHaveCount(2);
	await expect(dialog.getByRole("tab", { name: "Data" })).toHaveCount(0);
	await expect(dialog.getByRole("tab", { name: "Checks" })).toHaveCount(0);
	await expect(
		dialog.getByRole("region", { name: "Financial independence checks" }),
	).toHaveCount(0);
	const drawerBox = (await dialog.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(drawerBox.y).toBeCloseTo(0, 0);
	expect(drawerBox.x + drawerBox.width).toBeCloseTo(viewport.width, 0);
	expect(drawerBox.height).toBeCloseTo(viewport.height, 0);
	await expect(dialog.getByRole("tab", { name: "Overview" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const spendingBar = dialog.getByRole("img", { name: /^Annual spending at/ });
	await expect(spendingBar).toBeVisible();
	await expect(spendingBar).toHaveAttribute(
		"aria-label",
		/\$80,000.*is unfunded/,
	);
	await expect(
		dialog.getByRole("term").filter({ hasText: /^Unfunded$/ }),
	).toBeVisible();
	await expect(dialog.getByText("Not reached", { exact: true })).toHaveCount(0);
	await expect(
		dialog.getByRole("region", { name: "Base case", exact: true }),
	).toHaveCount(0);
	const startDate = dialog.getByRole("combobox", { name: "Start date" });
	await expect(startDate).toHaveCount(0);
	const dateLabel = dialog.getByText(/^Funding as of /);
	const evidenceDate = await dateLabel.textContent();
	await expect(dialog.getByRole("slider")).toHaveCount(0);
	await dialog.getByText("Compare start dates", { exact: true }).click();
	await expect(
		dialog.getByRole("img", {
			name: /Financial independence spending coverage/,
		}),
	).toBeVisible();
	await expect(dialog.getByRole("slider")).toHaveCount(0);
	await expect(
		dialog.getByRole("table", {
			name: "Selected financial independence funding sources",
		}),
	).toBeVisible();
	await expect(
		dialog.getByRole("rowheader", { name: /Brokerage/ }),
	).toBeVisible();
	await expect(dialog.getByRole("combobox")).toHaveCount(0);
	await expect(
		dialog.getByRole("columnheader", { name: "Test", exact: true }),
	).toHaveCount(0);
	await expect(startDate).toHaveCount(0);
	await expect(dateLabel).toHaveText(evidenceDate!);
	await expect(dialog.getByRole("combobox")).toHaveCount(0);
	await expect(
		dialog.getByRole("table", {
			name: "Financial independence funding over time",
		}),
	).toBeVisible();
	await expect(dialog.getByRole("slider")).toHaveCount(0);
	await dialog.getByRole("tab", { name: "Configure" }).click();
	await expect(dialog.getByLabel("Minimum net worth ($)")).toHaveValue("0");
	await expect(dialog.getByLabel("Spending test duration (years)")).toHaveValue(
		"10",
	);
	await expect(
		dialog.getByRole("button", { name: "Save configuration" }),
	).toBeVisible();
	await dialog.getByRole("tab", { name: "Configure" }).focus();
	await page.keyboard.press("Home");
	await expect(dialog.getByRole("tab", { name: "Overview" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(dateLabel).toHaveText(evidenceDate!);
	await expect(dialog.getByRole("slider")).toHaveCount(0);
	expect(projections).toBe(count);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(opener).toBeFocused();
	expect((await card.boundingBox())!.height).toBe(initialHeight);
	await opener.click();
	await expect(dialog).toBeVisible();
	await page.mouse.click(10, 10);
	await expect(dialog).not.toBeVisible();
	await expect(opener).toBeFocused();
	expect(projections).toBe(count);
	await card
		.getByRole("button", { name: "Pin Financial independence to Outlook" })
		.click();
	await page.getByRole("link", { name: "Outlook", exact: true }).click();
	await expect(card.getByRole("slider")).toHaveCount(0);
	await expect(
		card.getByRole("button", {
			name: "Unpin Financial independence from Outlook",
		}),
	).toBeVisible();
	await card
		.getByRole("button", {
			name: "Inspect independence for Financial independence",
		})
		.click();
	await expect(spendingBar).toBeVisible();
	await expect(dialog.getByRole("slider")).toHaveCount(0);
	await expect(dialog.getByRole("combobox")).toHaveCount(0);
	await dialog.getByRole("button", { name: "Close dialog" }).click();
	await expect(dialog).not.toBeVisible();
	const pins = await request.get(`${FIXTURE_API}/v1/pinned-evaluations`);
	expect((await pins.json()).instanceIds).toContain(id);
});

test("a complete test that cannot fit the horizon does not appear as financial failure", async ({
	page,
	request,
}) => {
	await addIndependence(request, { evaluationYears: 30 });
	await page.goto("/#evaluations");
	const card = page.getByRole("region", {
		name: "Financial independence",
		exact: true,
	});
	await expect(card.getByText("More horizon needed")).toBeVisible();
	await expect(
		card.getByRole("progressbar", { name: "Available projection horizon" }),
	).toHaveAttribute("aria-valuenow", "67");
	await expect(card.getByRole("slider")).toHaveCount(0);
	await expect(card.getByRole("button", { name: /failed/ })).toHaveCount(0);
	await card
		.getByRole("button", {
			name: "Inspect independence for Financial independence",
		})
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Financial independence",
		exact: true,
	});
	await expect(
		dialog.getByRole("progressbar", { name: "Required assessment period" }),
	).toBeVisible();
});

test("a self-sustaining base-case date remains distinct from its spending coverage", async ({
	page,
	request,
}) => {
	await addIndependence(request, {
		annualExpenseTarget: 100,
		annualExpenseGrowthRate: 0,
		principalPolicy: "allow-drawdown",
		continuingPostingIds: [],
		sources: [{ type: "cashflow", postingId: "salary", included: true }],
	});
	await page.goto("/#evaluations");
	const card = page.getByRole("region", {
		name: "Financial independence",
		exact: true,
	});
	await expect(card.getByText("Base case", { exact: true })).toBeVisible();
	await expect(card.getByText("Not reached", { exact: true })).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: /Inspect evidence/ }),
	).toHaveCount(0);
	await card
		.getByRole("button", {
			name: "Inspect independence for Financial independence",
		})
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Financial independence",
		exact: true,
	});
	await expect(dialog.getByText(/^Self-sustaining ·/)).toBeVisible();
	await expect(
		dialog.getByRole("region", { name: "Base case", exact: true }),
	).toHaveCount(0);
});

test("financial independence configuration updates minimum, duration, and funding sources", async ({
	page,
	request,
}) => {
	const id = await addIndependence(request);
	await page.goto("/#evaluations");
	const card = page.getByRole("region", {
		name: "Financial independence",
		exact: true,
	});
	await card
		.getByRole("button", {
			name: "Inspect independence for Financial independence",
		})
		.click();
	const dialog = page.getByRole("dialog", {
		name: "Financial independence",
		exact: true,
	});
	await expect(dialog.getByRole("tab", { name: "Configure" })).toBeVisible();
	await dialog.getByRole("tab", { name: "Configure" }).click();
	const minimum = dialog.getByLabel("Minimum net worth ($)");
	await expect(minimum).toHaveValue("0");
	const duration = dialog.getByLabel("Spending test duration (years)");
	await expect(duration).toHaveValue("10");
	const brokerage = dialog
		.getByRole("group", { name: "Funding accounts" })
		.getByRole("button", { name: /Brokerage/ });
	await expect(brokerage).toHaveAttribute("aria-pressed", "true");
	await minimum.fill("5000");
	await duration.fill("30");
	await brokerage.click();
	await expect(brokerage).toHaveAttribute("aria-pressed", "false");
	await dialog.getByRole("button", { name: "Save configuration" }).click();
	// Saving reloads the server model, which resets the inspector selection
	// and closes the drawer. Reopen to inspect the recalculated outcome.
	await expect(card.getByText("More horizon needed")).toBeVisible({
		timeout: 20000,
	});
	await card
		.getByRole("button", {
			name: "Inspect independence for Financial independence",
		})
		.click();
	await expect(
		dialog.getByRole("progressbar", { name: "Required assessment period" }),
	).toBeVisible();
	const model = (await (
		await request.get(`${FIXTURE_API}/v1/financial-model`)
	).json()) as FinancialModelResponse;
	const saved = model.model?.evaluations.financialIndependence.find(
		(item) => item.instanceId === id,
	);
	const config = saved?.config as Record<string, JsonValue>;
	expect(config.minimumNetWorth).toBe(5000);
	expect(config.evaluationYears).toBe(30);
	expect(
		(config.sources as { accountId?: string; included?: boolean }[]).filter(
			(source) => source.accountId === "brokerage" && source.included,
		),
	).toEqual([]);
});

for (const theme of ["light", "dark"]) {
	for (const width of [320, 390]) {
		test(`mobile cards stay compact and their modal is accessible (${theme}, ${width}px)`, async ({
			page,
			request,
		}) => {
			await addIndependence(request);
			await page.setViewportSize({ width, height: 844 });
			await page.addInitScript(
				(theme) => localStorage.setItem("waypoint-theme", theme),
				theme,
			);
			await page.goto("/#evaluations");
			const card = page.getByRole("region", {
				name: "Financial independence",
				exact: true,
			});
			await expect(
				card.getByRole("img", { name: /Spending coverage at/ }),
			).toBeVisible();
			await expect(
				card.getByRole("button", { name: /Inspect evidence/ }),
			).toHaveCount(0);
			const box = await card.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(width);
			expect(box!.height).toBeLessThan(470);
			const scan = await new AxeBuilder({ page }).include("main").analyze();
			expect(scan.violations).toEqual([]);
			const opener = card.getByRole("button", {
				name: "Inspect independence for Financial independence",
			});
			await opener.click();
			const dialog = page.getByRole("dialog", {
				name: "Financial independence",
				exact: true,
			});
			await expect(dialog.getByRole("tab")).toHaveCount(2);
			await expect(
				dialog.getByRole("tab", { name: "Overview" }),
			).toHaveAttribute("aria-selected", "true");
			await expect(dialog.getByRole("tab", { name: "Data" })).toHaveCount(0);
			await expect(
				dialog.getByRole("combobox", { name: "Start date" }),
			).toHaveCount(0);
			const modalBox = await dialog.boundingBox();
			expect(modalBox!.x).toBeGreaterThanOrEqual(0);
			expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(width);
			expect(modalBox!.x).toBeCloseTo(0, 0);
			expect(modalBox!.width).toBeCloseTo(width, 0);
			expect(modalBox!.height).toBeCloseTo(844, 0);
			const expanded = await new AxeBuilder({ page })
				.include('[role="dialog"]')
				.analyze();
			expect(expanded.violations).toEqual([]);
			await expect(
				dialog.getByRole("table", {
					name: "Selected financial independence funding sources",
				}),
			).toBeVisible();
			await expect(
				dialog.getByRole("region", { name: "Financial independence checks" }),
			).toHaveCount(0);
			await expect(
				dialog.getByRole("columnheader", { name: "Test", exact: true }),
			).toHaveCount(0);
			expect(
				await dialog.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			await dialog.getByRole("tab", { name: "Configure" }).click();
			await expect(dialog.getByLabel("Minimum net worth ($)")).toBeVisible();
			await expect(
				dialog.getByRole("button", { name: "Save configuration" }),
			).toBeVisible();
			expect(
				await dialog.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			const configure = await new AxeBuilder({ page })
				.include('[role="dialog"]')
				.analyze();
			expect(configure.violations).toEqual([]);
			await dialog.getByRole("tab", { name: "Overview" }).click();
			await expect(
				dialog.getByRole("region", { name: "Base case", exact: true }),
			).toHaveCount(0);
			await expect(
				dialog.getByText("Not reached", { exact: true }),
			).toHaveCount(0);
			await expect(
				dialog.getByRole("img", { name: /^Annual spending at/ }),
			).toBeVisible();
			await expect(
				dialog.getByRole("term").filter({ hasText: /^Unfunded$/ }),
			).toBeVisible();
			await expect(dialog.getByRole("slider")).toHaveCount(0);
			await expect(dialog.getByRole("combobox")).toHaveCount(0);
			expect(
				await dialog.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			const overview = await new AxeBuilder({ page })
				.include('[role="dialog"]')
				.analyze();
			expect(overview.violations).toEqual([]);
			await dialog.getByText("Compare start dates", { exact: true }).click();
			await expect(
				dialog.getByRole("img", {
					name: /Financial independence spending coverage/,
				}),
			).toBeVisible();
			await expect(dialog.getByRole("slider")).toHaveCount(0);
			await expect(dialog.getByRole("combobox")).toHaveCount(0);
			expect(
				await dialog.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			await page.keyboard.press("Escape");
			await expect(dialog).not.toBeVisible();
			await expect(opener).toBeFocused();
			const model = (await (
				await request.get(`${FIXTURE_API}/v1/financial-model`)
			).json()) as FinancialModelResponse;
			expect(model.model?.evaluations.financialIndependence[0]?.name).toBe(
				"Financial independence",
			);
		});
	}
}
