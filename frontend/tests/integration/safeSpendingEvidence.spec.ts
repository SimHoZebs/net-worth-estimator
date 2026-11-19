import { expect, request, test, type APIRequestContext } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const AS_OF = "2026-11-15";
const PAYDAY = "2026-11-30";
const OBSERVED_AT = Date.parse("2026-11-14T18:00:00Z") / 1000;

function isSummary(response: { url(): string }) {
	return new URL(response.url()).pathname === "/v1/safe-spending-summary";
}

const amount = (value: number) => ({
	resolver: "expression",
	config: { expression: String(value) },
	inputs: {},
});

// Synthetic reproduction: a newer investment observation must not advance the
// checking cut, today's bills must survive, and Nov 30 income is not cash now.
async function seedEvidence(api: APIRequestContext) {
	const reset = await api.post(`${FIXTURE_API}/__fixture/reset`, {
		data: { bankTransactions: [] },
	});
	expect(reset.ok(), await reset.text()).toBe(true);
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const accounts = [
		{ id: "evidence-checking", name: "Synthetic checking", kind: "cash" },
		{
			id: "evidence-investment",
			name: "Synthetic investment",
			kind: "investment",
		},
	].map((account) => ({
		...account,
		enabled: true,
		minBalance: account.kind === "cash" ? 0 : null,
		maxBalance: account.kind === "debt" ? 0 : null,
		statementClosingDay: 19,
		color: "#2f6f4f",
		display: {
			name: account.name,
			components: [{ accountId: account.id, role: "primary" }],
			interestScheduleId: "",
			paymentScheduleId: "",
		},
	}));
	const schedule = (id: string, name: string, value: number, day: number) => ({
		id,
		name,
		sourceAccountId: "evidence-checking",
		destinations: [],
		amount: amount(value),
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: `2026-11-${String(day).padStart(2, "0")}`,
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	});
	const schedules = [
		schedule("evidence-today-a", "Synthetic due today A", 711.12, 15),
		schedule("evidence-today-b", "Synthetic due today B", 98.92, 15),
		schedule("evidence-future-a", "Synthetic later bill A", 400, 20),
		schedule("evidence-future-b", "Synthetic later bill B", 159.89, 23),
		schedule("evidence-future-c", "Synthetic later bill C", 91.08, 27),
		{
			...schedule("evidence-salary", "Synthetic future salary", 400, 30),
			sourceAccountId: null,
			destinations: ["evidence-checking"],
		},
	];
	const transactions: Record<string, unknown>[] = [
		{
			id: "01900000-0000-7000-8000-00000000e001",
			name: "Synthetic card charge",
			sourceAccountId: "loan",
			destinations: [],
			amount: amount(50),
			transactionTime: Date.parse("2026-11-13T12:00:00Z") / 1000,
			postedTime: Date.parse("2026-11-13T12:00:00Z") / 1000,
			enabled: true,
		},
	];
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: {
			model: {
				...baseline,
				accounts: [...baseline.accounts, ...accounts],
				checkpoints: [
					...baseline.checkpoints,
					{
						AccountId: "evidence-investment",
						Balance: 10000,
						source: "user",
						observedAt: Date.parse("2026-11-15T09:00:00Z") / 1000,
					},
				],
				transactions: [...baseline.transactions, ...transactions],
				schedules: [...baseline.schedules, ...schedules],
			},
		},
	});
	expect(imported.ok(), await imported.text()).toBe(true);
	const observations = await api.post(
		`${FIXTURE_API}/__fixture/cash-observations`,
		{
			data: {
				checkpoints: [
					{
						accountId: "evidence-checking",
						postedBalance: 1608.05,
						availableBalance: 1244.43,
						observedAt: OBSERVED_AT,
					},
				],
			},
		},
	);
	expect(observations.ok(), await observations.text()).toBe(true);
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			reserve: 200,
			accountIds: ["loan"],
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

test("the dated allowance and protected obligations come from the server", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api);
		const response = await api.get(`${FIXTURE_API}/v1/safe-spending-summary`);
		expect(response.ok(), await response.text()).toBe(true);
		expect(response.headers()["cache-control"]).toContain("no-store");
		const summary = await response.json();
		expect(summary).toMatchObject({
			payday: PAYDAY,
			expectedPay: 400,
			reserve: 200,
			checkingAvailable: 1244.43,
			selectedAccountIds: ["evidence-checking"],
		});
		expect(summary).not.toHaveProperty("start");
		expect(summary).not.toHaveProperty("end");
		expect(summary).not.toHaveProperty("cashAfterBills");
		expect(Array.isArray(summary.bills)).toBe(true);
		expect(Array.isArray(summary.statements)).toBe(true);
		expect(summary).toHaveProperty("safeToSpend");

		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		const browserSummary = page.waitForResponse(isSummary);
		await page.goto("/outlook");
		const served = await (await browserSummary).json();
		expect(served).toMatchObject({ payday: PAYDAY });

		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("safe-to-spend")).toBeVisible();
		await expect(card.getByText("Through payday · Nov 30, 2026")).toBeVisible();
		if (served.status === "available") {
			await expect(
				card.getByRole("region", { name: "Cash check comparison" }),
			).toBeVisible();
			await expect(card.getByText(/is the tighter check\./)).toBeVisible();
			await expect(card.locator('[aria-label="Before payday"]')).toBeVisible();
			await expect(
				card.locator('[aria-label="After payday pay"]'),
			).toBeVisible();
		} else {
			await expect(
				card.getByText(/Allowance (uncertain|unavailable)/),
			).toBeVisible();
		}
		// Secondary detail lives in the drawer, not in the preview.
		await expect(
			card.getByRole("region", { name: "Protected obligations" }),
		).toHaveCount(0);
		await expect(card.getByTestId("cash-on-hand")).toHaveCount(0);
		await expect(card.getByText("Bills before payday")).toHaveCount(0);
		await expect(card.locator("details")).toHaveCount(0);

		await card.getByRole("button", { name: /Protected obligations ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(
			drawer.getByRole("region", { name: "Cash checks" }),
		).toBeVisible();
		await expect(drawer.getByText("Expected pay")).toBeVisible();
		await expect(
			drawer.getByRole("region", { name: "Cash evidence" }),
		).toBeVisible();
		await expect(drawer.getByTestId("cash-on-hand")).toHaveText("$1,244.43");
		await expect(
			drawer.getByRole("region", { name: "Protected obligations" }),
		).toBeVisible();
		await expect(drawer.getByText("Bills before payday")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
	} finally {
		await api.dispose();
	}
});

test("changing included bills refreshes the dated allowance without reloading", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		const initialResponse = page.waitForResponse(isSummary);
		await page.goto("/outlook");
		await (await initialResponse).json();
		const card = page.getByRole("region", { name: "Safe spending" });
		const protectedSummary = card.getByRole("button", {
			name: /Protected obligations ·/,
		});
		await expect(protectedSummary).toBeVisible();
		const initialSummary = await protectedSummary.textContent();

		await card.getByRole("button", { name: "Configure", exact: true }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		const bill = drawer.getByRole("button", {
			name: /Synthetic later bill A/,
		});
		await expect(bill).toHaveAttribute("aria-pressed", "true");
		const saved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
				response.request().method() === "PUT",
		);
		await bill.click();
		expect((await saved).ok()).toBe(true);
		await expect(bill).toHaveAttribute("aria-pressed", "false");
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
		await expect(protectedSummary).not.toHaveText(initialSummary!, {
			timeout: 15_000,
		});
	} finally {
		await api.dispose();
	}
});

test("uncertain evidence withholds the allowance but keeps obligations visible", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		await page.route("**/v1/safe-spending-summary", async (route) => {
			const response = await route.fetch();
			const body = await response.json();
			await route.fulfill({
				response,
				json: {
					...body,
					status: "uncertain",
					checkingAvailable: null,
					safeToSpend: null,
					prePaydayRoom: null,
					postIncomeRoom: null,
					reasons: ["pending-obligation-coverage-unknown"],
				},
			});
		});
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("safe-to-spend")).toHaveText("—");
		await expect(card.getByText("Allowance uncertain")).toBeVisible();
		await expect(
			card.getByRole("region", { name: "Cash check comparison" }),
		).toHaveCount(0);
		await expect(
			card.getByText("pending-obligation-coverage-unknown"),
		).toHaveCount(0);
		await card.getByRole("button", { name: /Protected obligations ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(
			drawer.getByRole("region", { name: "Protected obligations" }),
		).toBeVisible();
		await expect(drawer.getByText("Bills before payday")).toBeVisible();
	} finally {
		await api.dispose();
	}
});

test("a failed summary request stays retryable in the preview without data", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		let attempts = 0;
		await page.route("**/v1/safe-spending-summary", async (route) => {
			attempts += 1;
			if (attempts === 1)
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "synthetic failure" }),
				});
			else await route.continue();
		});
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(
			card.getByText("Safe spending evidence could not be loaded."),
		).toBeVisible();
		await expect(card.getByTestId("safe-to-spend")).toHaveCount(0);
		await card.getByRole("button", { name: "Retry evidence" }).click();
		await expect(card.getByTestId("safe-to-spend")).toBeVisible();
		expect(attempts).toBeGreaterThanOrEqual(2);
	} finally {
		await api.dispose();
	}
});
