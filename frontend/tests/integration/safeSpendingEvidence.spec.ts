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

// Synthetic production shape: one bill is due on the same UTC date as the
// cash observation and has no posted claim. The server cannot tell whether
// the payment is already inside the observed balance, so it withholds the
// allowance while keeping the bill, the cash and the payday visible.
async function seedSameDayObservation(
	api: APIRequestContext,
	today: string,
	payday: string,
) {
	const reset = await api.post(`${FIXTURE_API}/__fixture/reset`, {
		data: { bankTransactions: [] },
	});
	expect(reset.ok(), await reset.text()).toBe(true);
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const checking = {
		id: "evidence-checking",
		name: "Synthetic checking",
		kind: "cash",
		enabled: true,
		minBalance: 0,
		maxBalance: null,
		statementClosingDay: 19,
		color: "#2f6f4f",
		display: {
			name: "Synthetic checking",
			components: [{ accountId: "evidence-checking", role: "primary" }],
			interestScheduleId: "",
			paymentScheduleId: "",
		},
	};
	const bill = {
		id: "evidence-same-day-bill",
		name: "Synthetic same-day bill",
		sourceAccountId: "evidence-checking",
		destinations: [],
		amount: amount(711.12),
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: today,
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	};
	const salary = {
		...bill,
		id: "evidence-salary",
		name: "Synthetic future salary",
		amount: amount(400),
		sourceAccountId: null,
		destinations: ["evidence-checking"],
		startDate: payday,
	};
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: {
			model: {
				...baseline,
				accounts: [...baseline.accounts, checking],
				checkpoints: [...baseline.checkpoints],
				transactions: [...baseline.transactions],
				schedules: [...baseline.schedules, bill, salary],
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
						observedAt: Math.floor(Date.now() / 1000) - 120,
					},
				],
			},
		},
	);
	expect(observations.ok(), await observations.text()).toBe(true);
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			reserve: 200,
			accountIds: [],
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

// Sync provisions unknown bank accounts with the neutral cash kind. The owner
// still tracks them as cards through the explicit selection, so the payday
// payoff must honour that selection instead of silently dropping it.
async function seedCashLabelledCard(
	api: APIRequestContext,
	payday: string,
) {
	const reset = await api.post(`${FIXTURE_API}/__fixture/reset`, {
		data: { bankTransactions: [] },
	});
	expect(reset.ok(), await reset.text()).toBe(true);
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const account = (id: string, name: string, kind: string) => ({
		id,
		name,
		kind,
		enabled: true,
		minBalance: 0,
		maxBalance: null,
		statementClosingDay: 19,
		color: "#2f6f4f",
		display: {
			name,
			components: [{ accountId: id, role: "primary" }],
			interestScheduleId: "",
			paymentScheduleId: "",
		},
	});
	const checking = account("evidence-checking", "Synthetic checking", "cash");
	const card = account("evidence-synced-card", "Synthetic synced card", "cash");
	const salary = {
		id: "evidence-salary",
		name: "Synthetic future salary",
		sourceAccountId: null,
		destinations: ["evidence-checking"],
		amount: amount(400),
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: payday,
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	};
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: {
			model: {
				...baseline,
				accounts: [...baseline.accounts, checking, card],
				checkpoints: [
					...baseline.checkpoints,
					{
						AccountId: "evidence-synced-card",
						Balance: -125,
						source: "user",
						observedAt: Date.parse("2026-01-01T00:00:00Z") / 1000,
					},
				],
				transactions: [...baseline.transactions],
				schedules: [...baseline.schedules, salary],
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
						observedAt: Math.floor(Date.now() / 1000) - 120,
					},
				],
			},
		},
	);
	expect(observations.ok(), await observations.text()).toBe(true);
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			reserve: 200,
			accountIds: ["evidence-synced-card"],
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

// A posted transaction linked to the exact schedule occurrence settles that
// bill. No amount/date guessing is involved.
async function seedConfirmedBill(
	api: APIRequestContext,
	today: string,
	payday: string,
) {
	const reset = await api.post(`${FIXTURE_API}/__fixture/reset`, {
		data: { bankTransactions: [] },
	});
	expect(reset.ok(), await reset.text()).toBe(true);
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const checking = {
		id: "evidence-checking",
		name: "Synthetic checking",
		kind: "cash",
		enabled: true,
		minBalance: 0,
		maxBalance: null,
		statementClosingDay: 19,
		color: "#2f6f4f",
		display: {
			name: "Synthetic checking",
			components: [{ accountId: "evidence-checking", role: "primary" }],
			interestScheduleId: "",
			paymentScheduleId: "",
		},
	};
	const bill = {
		id: "evidence-bill",
		name: "Synthetic confirmed bill",
		sourceAccountId: "evidence-checking",
		destinations: [],
		amount: amount(100),
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: today,
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	};
	const salary = {
		...bill,
		id: "evidence-salary",
		name: "Synthetic future salary",
		sourceAccountId: null,
		destinations: ["evidence-checking"],
		startDate: payday,
	};
	const posted = Date.parse(`${today}T09:00:00Z`) / 1000;
	const payment = {
		id: "01900000-0000-7000-8000-00000000c001",
		name: "Synthetic linked payment",
		sourceAccountId: "evidence-checking",
		destinations: [],
		amount: amount(100),
		transactionTime: posted,
		postedTime: posted,
		enabled: true,
		claim: { scheduleId: bill.id, occurrenceDate: today },
	};
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: {
			model: {
				...baseline,
				accounts: [...baseline.accounts, checking],
				schedules: [...baseline.schedules, bill, salary],
				transactions: [...baseline.transactions, payment],
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
						postedBalance: 1000,
						availableBalance: 900,
						observedAt: Math.floor(Date.now() / 1000) - 120,
					},
				],
			},
		},
	);
	expect(observations.ok(), await observations.text()).toBe(true);
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			reserve: 200,
			accountIds: [],
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: [bill.id],
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

// Known cash and known bills, but a tracked card has no balance at the
// statement close. The allowance is withheld while before-payoff room is known.
async function seedFallbackNumeric(
	api: APIRequestContext,
	today: string,
	payday: string,
) {
	const reset = await api.post(`${FIXTURE_API}/__fixture/reset`, {
		data: { bankTransactions: [] },
	});
	expect(reset.ok(), await reset.text()).toBe(true);
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const account = (id: string, name: string) => ({
		id,
		name,
		kind: "cash",
		enabled: true,
		minBalance: 0,
		maxBalance: null,
		statementClosingDay: 19,
		color: "#2f6f4f",
		display: {
			name,
			components: [{ accountId: id, role: "primary" }],
			interestScheduleId: "",
			paymentScheduleId: "",
		},
	});
	const bill = {
		id: "evidence-bill",
		name: "Synthetic known bill",
		sourceAccountId: "evidence-checking",
		destinations: [],
		amount: amount(100),
		recurrence: { unit: "month", interval: 1, monthlyMode: "byDate" },
		startDate: today,
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	};
	const salary = {
		...bill,
		id: "evidence-salary",
		name: "Synthetic future salary",
		sourceAccountId: null,
		destinations: ["evidence-checking"],
		startDate: payday,
	};
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: {
			model: {
				...baseline,
				accounts: [
					...baseline.accounts,
					account("evidence-checking", "Synthetic checking"),
					account("evidence-unknown-card", "Synthetic unknown card"),
				],
				schedules: [...baseline.schedules, bill, salary],
				checkpoints: [
					...baseline.checkpoints,
					{
						AccountId: "evidence-unknown-card",
						Balance: -50,
						source: "banksync",
						observedAt: Math.floor(Date.now() / 1000) - 120,
					},
				],
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
						postedBalance: 1000,
						availableBalance: 900,
						observedAt: Math.floor(Date.now() / 1000) - 86_400,
					},
				],
			},
		},
	);
	expect(observations.ok(), await observations.text()).toBe(true);
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			reserve: 200,
			accountIds: ["evidence-unknown-card"],
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: [bill.id],
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

test("an explicit cash-labelled card keeps its statement payoff", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		const today = new Date().toISOString().slice(0, 10);
		const payday = new Date(Date.parse(`${today}T00:00:00Z`) + 11 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		await seedCashLabelledCard(api, payday);
		const response = await api.get(`${FIXTURE_API}/v1/safe-spending-summary`);
		expect(response.ok(), await response.text()).toBe(true);
		const summary = await response.json();
		expect(summary.status).toBe("available");
		expect(summary.statements.length).toBeGreaterThan(0);
		expect(summary.statementReserve).toBeGreaterThan(0);
		for (const statement of summary.statements) {
			expect(statement.accountId).toBe("evidence-synced-card");
		}

		await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("safe-to-spend")).toBeVisible();
		await card
			.getByRole("button", { name: /Protected obligations ·/ })
			.click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(drawer.getByText("Card payoff on payday")).toBeVisible();
		const payoff = drawer.getByRole("list", {
			name: "Card payoff on payday",
		});
		expect(await payoff.getByText("Synthetic synced card").count()).toBeGreaterThan(0);
	} finally {
		await api.dispose();
	}
});

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

// Verified against the real backend with this seed: cash 1244.43, reserve 200,
// the unclaimed bill 711.12 and income 400 give 333.31 / 711.12 / 733.31.
test("an unclaimed same-day bill stays expected and keeps a numeric allowance", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		const today = new Date().toISOString().slice(0, 10);
		const payday = new Date(Date.parse(`${today}T00:00:00Z`) + 11 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		await seedSameDayObservation(api, today, payday);
		const response = await api.get(`${FIXTURE_API}/v1/safe-spending-summary`);
		expect(response.ok(), await response.text()).toBe(true);
		const summary = await response.json();
		expect(summary).toMatchObject({
			cashAsOf: today,
			payday,
			status: "available",
			checkingAvailable: 1244.43,
			reserve: 200,
			expectedPay: 400,
			prePaydayBills: 711.12,
			prePaydayRoom: 333.31,
			postIncomeRoom: 733.31,
			safeToSpend: 333.31,
		});
		expect(summary.reasons).not.toContain("scheduled-payment-status-unknown");
		const bill = summary.bills.find(
			(row: { name: string }) => row.name === "Synthetic same-day bill",
		);
		expect(bill).toMatchObject({
			date: today,
			status: "unpaid",
			transactionId: null,
			amount: 711.12,
		});

		await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByText("Safe to spend before payday")).toBeVisible();
		await expect(card.getByTestId("safe-to-spend")).toHaveText("$333.31");
		await expect(card.getByText("Allowance uncertain")).toHaveCount(0);
		await expect(card.getByText(/already be included/)).toHaveCount(0);
		await expect(
			card.getByRole("button", { name: /Protected obligations ·/ }),
		).toBeVisible();
		await card
			.getByRole("button", { name: /Protected obligations ·/ })
			.click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(drawer.getByText("Bills before payday")).toBeVisible();
		await expect(drawer.getByText("Synthetic same-day bill")).toBeVisible();
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
		await expect(card.getByText("Allowance uncertain")).toHaveCount(0);
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

test("a linked transaction confirms its bill and keeps a numeric allowance", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		const today = new Date().toISOString().slice(0, 10);
		const payday = new Date(Date.parse(`${today}T00:00:00Z`) + 11 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		await seedConfirmedBill(api, today, payday);
		const response = await api.get(`${FIXTURE_API}/v1/safe-spending-summary`);
		expect(response.ok(), await response.text()).toBe(true);
		const summary = await response.json();
		const bill = summary.bills.find(
			(row: { name: string }) => row.name === "Synthetic confirmed bill",
		);
		expect(bill).toMatchObject({ status: "paid" });
		expect(bill.transactionId).not.toBeNull();
		expect(summary.safeToSpend).not.toBeNull();

		await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("safe-to-spend")).not.toHaveText("—");
		await card.getByRole("button", { name: /Protected obligations ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(drawer.getByText("Bills before payday")).toBeVisible();
		await expect(drawer.getByText("Synthetic confirmed bill")).toHaveCount(0);
	} finally {
		await api.dispose();
	}
});

test("leads with before-payoff room when statement amounts are unknown", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		const today = new Date().toISOString().slice(0, 10);
		const payday = new Date(Date.parse(`${today}T00:00:00Z`) + 11 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		await seedFallbackNumeric(api, today, payday);
		const response = await api.get(`${FIXTURE_API}/v1/safe-spending-summary`);
		expect(response.ok(), await response.text()).toBe(true);
		const summary = await response.json();
		expect(summary.safeToSpend).toBeNull();
		expect(summary.statementReserve).toBeNull();
		expect(summary.prePaydayRoom).not.toBeNull();

		await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByText("Before card payoffs")).toBeVisible();
		await expect(card.getByTestId("safe-to-spend")).toHaveText(
			amountTextFor(summary.prePaydayRoom),
		);
	} finally {
		await api.dispose();
	}
});

function amountTextFor(value: number) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(value);
}
