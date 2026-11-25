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
		{ id: "evidence-card", name: "Synthetic card", kind: "credit_card" },
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
			sourceAccountId: "evidence-card",
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
					{
						AccountId: "evidence-card",
						Balance: -50,
						source: "user",
						observedAt: OBSERVED_AT,
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
			accountIds: ["evidence-card"],
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

const TRANSFER_PAYMENT_ID = "01900000-0000-7000-8000-00000000e010";
const TRANSFER_CARD_LEG_ID = "01900000-0000-7000-8000-00000000e011";
const TRANSFER_TIME = Date.parse("2026-11-13T18:00:00Z") / 1000;
const confirmedTransferLink = {
	legA: TRANSFER_PAYMENT_ID,
	legB: TRANSFER_CARD_LEG_ID,
	actor: "owner",
	createdAt: 1,
	findingId: "synthetic-confirmed-transfer",
};

async function seedConfirmedCashTransfer(api: APIRequestContext) {
	await seedEvidence(api);
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok(), await read.text()).toBe(true);
	const { model } = await read.json();
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: {
			model: {
				...model,
				transactions: [
					...model.transactions,
					{
						id: TRANSFER_PAYMENT_ID,
						name: "Synthetic confirmed cash payment",
						sourceAccountId: "evidence-checking",
						destinations: null,
						amount: amount(80),
						transactionTime: TRANSFER_TIME,
						postedTime: TRANSFER_TIME,
						enabled: true,
					},
					{
						id: TRANSFER_CARD_LEG_ID,
						name: "Synthetic confirmed card leg",
						sourceAccountId: null,
						destinations: ["evidence-card"],
						amount: amount(80),
						transactionTime: TRANSFER_TIME + 60,
						postedTime: TRANSFER_TIME + 60,
						enabled: true,
					},
				],
			},
		},
	});
	expect(imported.ok(), await imported.text()).toBe(true);
}

async function seedTrackedCard(api: APIRequestContext, payday: string) {
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
	const card = account(
		"evidence-synced-card",
		"Synthetic synced card",
		"credit_card",
	);
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
		destinations: null,
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
	const posted = Math.floor(Date.now() / 1000) - 120;
	const payment = {
		id: "01900000-0000-7000-8000-00000000c001",
		name: "Synthetic linked payment",
		sourceAccountId: "evidence-checking",
		destinations: null,
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
					{
						...account("evidence-unknown-card", "Synthetic unknown card"),
						kind: "credit_card",
					},
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
			accountIds: ["evidence-unknown-card"],
			paydayDay: Number(payday.slice(-2)),
			spendingAccountIds: ["evidence-checking"],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: [bill.id],
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

test("an explicitly tracked card keeps its statement payoff", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		const today = new Date().toISOString().slice(0, 10);
		const payday = new Date(Date.parse(`${today}T00:00:00Z`) + 11 * 86_400_000)
			.toISOString()
			.slice(0, 10);
		await seedTrackedCard(api, payday);
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
		await expect(
			card.getByRole("region", { name: "Cycle budget" }),
		).toBeVisible();
		await expect(
			card.getByRole("region", { name: "Next cycle spending" }),
		).toBeVisible();
		await card.getByRole("button", { name: /^Details ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(drawer.getByText("No spending this cycle yet.")).toBeVisible();
		await expect(drawer.getByText("Credit card payoffs")).toHaveCount(0);
	} finally {
		await api.dispose();
	}
});

test("the dated allowance and recorded transactions come from the server", async ({
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
			checkingAvailable: 1244.43,
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
		await expect(
			card.getByRole("region", { name: "Cycle budget" }),
		).toBeVisible();
		await expect(
			card.getByRole("region", { name: "Next cycle spending" }),
		).toBeVisible();
		// Secondary detail lives in the drawer, not in the preview.
		await expect(card.getByRole("region", { name: "Cash checks" })).toHaveCount(
			0,
		);
		await expect(card.getByRole("region", { name: "Details" })).toHaveCount(0);
		await expect(card.getByTestId("cash-on-hand")).toHaveCount(0);
		await expect(card.getByText("Bills before card payoff")).toHaveCount(0);
		await expect(card.locator("details[open]")).toHaveCount(0);
		const previewAction = card.getByRole("button", {
			name: /^Details ·/,
		});
		await expect(previewAction).toHaveText(
			/^Details · \$[\d,.]+ · \d+ items?$/,
		);
		await expect(
			card.getByRole("button", { name: /^Transactions/ }),
		).toHaveCount(0);

		await previewAction.click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(
			drawer.getByRole("tab", { name: /Transactions/ }),
		).toHaveAttribute("aria-selected", "true");
		await expect(drawer.getByText("Oct 31, 2026 – Nov 30, 2026")).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(drawer.getByText("Spent", { exact: true })).toBeVisible();
		await expect(
			drawer.getByText("$50.00", { exact: true }).first(),
		).toBeVisible();
		const charge = drawer.getByRole("button", {
			name: /^View Synthetic card charge /,
		});
		await expect(charge).toBeVisible();
		await charge.click();
		const inspection = page.getByRole("dialog", {
			name: "Synthetic card charge",
			exact: true,
		});
		await expect(inspection).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(inspection).toBeHidden();
		await expect(drawer).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
	} finally {
		await api.dispose();
	}
});

test("transactions wait for confirmed links without blocking the budget", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedConfirmedCashTransfer(api);
		let releaseLinks!: () => void;
		const linksReady = new Promise<void>((resolve) => {
			releaseLinks = resolve;
		});
		await page.route("**/v1/transfer-links", async (route) => {
			const response = await route.fetch();
			const body = await response.json();
			await linksReady;
			await route.fulfill({
				response,
				json: { ...body, links: [confirmedTransferLink] },
			});
		});
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		await page.goto("/outlook?detail=safe-spending&tab=transactions");
		// The modal drawer makes the background card inert, so assert its
		// rendered state through DOM locators rather than the accessibility tree.
		const card = page.locator('[role="region"][aria-label="Safe spending"]');
		await expect(card.getByTestId("with-cash-cushion")).toBeVisible();
		const action = card.locator("button").filter({ hasText: /^Details ·/ });
		await expect(action).toBeVisible();
		await expect(action).toBeEnabled();
		await expect(action).toHaveText(/^Details ·/);
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(drawer.getByText("Loading transactions…")).toBeVisible();
		await expect(drawer.getByText("Spent", { exact: true })).toHaveCount(0);
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toHaveCount(0);
		await expect(
			drawer.getByRole("heading", { name: "Cash payments this cycle" }),
		).toHaveCount(0);
		releaseLinks();
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: "Cash payments this cycle" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("button", {
				name: /^View Synthetic confirmed cash payment /,
			}),
		).toBeVisible();
		const spendingTable = drawer.getByRole("table", {
			name: /Spending this cycle,/,
		});
		await expect(
			spendingTable.getByText("Synthetic confirmed cash payment"),
		).toHaveCount(0);
	} finally {
		api.dispose();
	}
});

test("failed transaction links keep the budget usable and retry in the drawer", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedConfirmedCashTransfer(api);
		let failLinks = true;
		let attempts = 0;
		await page.route("**/v1/transfer-links", async (route) => {
			attempts += 1;
			if (failLinks)
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "synthetic link failure" }),
				});
			else {
				const response = await route.fetch();
				const body = await response.json();
				await route.fulfill({
					response,
					json: { ...body, links: [confirmedTransferLink] },
				});
			}
		});
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("with-cash-cushion")).toBeVisible();
		const action = card.getByRole("button", { name: /^Details ·/ });
		await expect(action).toBeVisible();
		await expect(action).toBeEnabled();
		await expect(action).toHaveText(/^Details ·/);
		await page.goto("/outlook?detail=safe-spending&tab=transactions");
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		const alert = drawer.getByRole("alert", {
			name: "Safe spending transactions",
		});
		await expect(alert).toBeVisible();
		await expect(alert.getByText("Transactions unavailable")).toBeVisible();
		await expect(drawer.getByText("Spent", { exact: true })).toHaveCount(0);
		await expect(
			drawer.getByRole("heading", { name: "Cash payments this cycle" }),
		).toHaveCount(0);
		failLinks = false;
		await alert.getByRole("button", { name: "Retry transactions" }).click();
		await expect(
			drawer.getByRole("heading", { name: "Cash payments this cycle" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("button", {
				name: /^View Synthetic confirmed cash payment /,
			}),
		).toBeVisible();
		expect(attempts).toBeGreaterThanOrEqual(3);
	} finally {
		api.dispose();
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
			name: /^Details ·/,
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

test("no cash balance leaves recorded transactions visible", async ({
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
					fundingRoom: null,
					prePaydayRoom: null,
					postIncomeRoom: null,
					paymentRoom: null,
					nextCycleDiscretionary: null,
					nextCycleIncome: null,
					nextCycleCarryover: null,
					reasons: ["pending-obligation-coverage-unknown"],
				},
			});
		});
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("with-cash-cushion")).toHaveText(
			"Cash balance missing",
		);
		await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
			"Unavailable",
		);
		await expect(
			card.getByRole("img", { name: /^Next cycle funding: / }),
		).toHaveCount(0);
		await expect(card.getByText("Allowance uncertain")).toHaveCount(0);
		await expect(
			card.getByText("pending-obligation-coverage-unknown"),
		).toHaveCount(0);
		await card.getByRole("button", { name: /^Details ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("button", { name: /^View Synthetic card charge / }),
		).toBeVisible();
		await expect(
			drawer.getByText("$50.00", { exact: true }).first(),
		).toBeVisible();
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
		await expect(card.getByTestId("with-cash-cushion")).toHaveCount(0);
		const previewAction = card.getByRole("button", { name: /^Details ·/ });
		await expect(previewAction).toHaveCount(0);
		await card.getByRole("button", { name: "Retry evidence" }).click();
		await expect(card.getByTestId("with-cash-cushion")).toBeVisible();
		await expect(previewAction).toBeVisible();
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
		await expect(card.getByTestId("with-cash-cushion")).not.toHaveText(
			"Unavailable",
		);
		await card.getByRole("button", { name: /^Details ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("button", { name: /^View Synthetic linked payment / }),
		).toBeVisible();
		await expect(drawer.getByText("Synthetic confirmed bill")).toHaveCount(0);
	} finally {
		await api.dispose();
	}
});

test("shows a missing future checkpoint when statement amounts are unknown", async ({
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
		// Unknown card payoffs withhold the cycle budget rather than showing a
		// clamped zero; recorded activity stays independently visible.
		await expect(card.getByTestId("with-cash-cushion")).toHaveText(
			"Unavailable",
		);
		await card.getByRole("button", { name: /^Details ·/ }).click();
		const drawer = page.getByRole("dialog", { name: "Safe spending" });
		await expect(drawer.getByText("No spending this cycle yet.")).toBeVisible();
		await expect(
			drawer.getByText("$0.00", { exact: true }).first(),
		).toBeVisible();
	} finally {
		await api.dispose();
	}
});

test("an unknown next-cycle component stays unknown without hiding the known component", async ({
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
					nextCycleEnd: "2026-12-29",
					nextCycleIncome: 350,
					nextCycleCarryover: null,
					nextCycleDiscretionary: null,
				},
			});
		});
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
			"Unavailable",
		);
		await expect(card.getByTestId("next-cycle-income")).toHaveText("$350.00");
		await expect(card.getByTestId("next-cycle-carryover")).toHaveText(
			"Unavailable",
		);
		await expect(
			card.getByRole("img", { name: /^Next cycle funding: / }),
		).toHaveCount(0);
	} finally {
		await api.dispose();
	}
});

test("known next-cycle spending shows its funding composition", async ({
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
					cycleReset: "2026-11-20",
					nextCycleEnd: "2026-12-19",
					nextCycleIncome: 200,
					nextCycleCarryover: 150,
					nextCycleDiscretionary: 350,
				},
			});
		});
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("discretionary-next-cycle")).toHaveText(
			"$350.00",
		);
		const nextCycle = card.getByRole("region", { name: "Next cycle spending" });
		await expect(nextCycle.locator("time")).toHaveText(["Nov 20", "Dec 19"]);
		await expect(nextCycle.getByTestId("next-cycle-income")).toHaveText(
			"From income · $200.00",
		);
		await expect(nextCycle.getByTestId("next-cycle-carryover")).toHaveText(
			"Cash carried forward · $150.00",
		);
		await expect(
			nextCycle.getByRole("img", {
				name: "Next cycle funding: From income $200.00. Cash carried forward $150.00.",
			}),
		).toBeVisible();
	} finally {
		await api.dispose();
	}
});
