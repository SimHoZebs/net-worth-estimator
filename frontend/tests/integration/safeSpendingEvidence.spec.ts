import { expect, request, test, type APIRequestContext } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const AS_OF = "2026-11-15";
const OBSERVED_AT = Date.parse("2026-11-14T18:00:00Z") / 1000;
function isCurrentSummary(response: { url(): string }) {
	const url = new URL(response.url());
	return (
		url.pathname === "/v1/safe-spending-summary" &&
		url.searchParams.get("start") === AS_OF &&
		url.searchParams.get("end") === "2026-11-30"
	);
}
const amount = (value: number) => ({
	resolver: "expression",
	config: { expression: String(value) },
	inputs: {},
});

// Synthetic reproduction: a newer investment observation must not advance the
// checking cut, today's bills must survive, and Nov 30 income is not cash now.
async function seedEvidence(
	api: APIRequestContext,
	pending = false,
	crossing = false,
) {
	// The existing fixture bank snapshot maps its single bridge to checking.
	const checkingId = pending ? "checking" : "evidence-checking";
	if (pending) {
		const reset = await api.post(`${FIXTURE_API}/__fixture/reset`, {
			data: {
				bankTransactions: [
					{
						id: "evidence-pending-bank",
						description: "Synthetic held payment",
						amount: "-363.62",
						posted: OBSERVED_AT - 3600,
						transacted_at: OBSERVED_AT - 3600,
						pending: true,
					},
				],
			},
		});
		expect(reset.ok(), await reset.text()).toBe(true);
	}
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
		{ id: "evidence-card", name: "Synthetic card", kind: "debt" },
	].map((account) => ({
		...account,
		enabled: true,
		minBalance: account.kind === "cash" ? 0 : null,
		maxBalance: account.kind === "debt" ? 0 : null,
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
		sourceAccountId: checkingId,
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
			...schedule("evidence-salary", "Synthetic future salary", 7458.34, 30),
			...(crossing ? { startDate: "2026-10-08" } : {}),
			sourceAccountId: null,
			destinations: [checkingId],
		},
	];
	if (crossing)
		schedules.push({
			...schedule("evidence-other-income", "Synthetic other income", 999, 30),
			sourceAccountId: null,
			destinations: [checkingId],
		});
	const transactions: Record<string, unknown>[] = [
		{
			id: "01900000-0000-7000-8000-00000000e003",
			name: "Synthetic previous cycle purchase",
			sourceAccountId: "evidence-card",
			destinations: [],
			amount: amount(125),
			transactionTime: Date.parse("2026-10-05T12:00:00Z") / 1000,
			postedTime: Date.parse("2026-10-05T12:00:00Z") / 1000,
			enabled: true,
		},
		{
			id: "01900000-0000-7000-8000-00000000e004",
			name: "Synthetic one-time card settlement",
			sourceAccountId: checkingId,
			destinations: ["evidence-card"],
			amount: amount(80),
			transactionTime: Date.parse("2026-10-10T12:00:00Z") / 1000,
			postedTime: Date.parse("2026-10-10T12:00:00Z") / 1000,
			enabled: true,
		},
		{
			id: "01900000-0000-7000-8000-00000000e001",
			name: "Synthetic card charge",
			sourceAccountId: "evidence-card",
			destinations: [],
			amount: amount(crossing ? 100 : 50),
			transactionTime:
				Date.parse(crossing ? "2026-11-09T10:00:00Z" : "2026-11-13T12:00:00Z") /
				1000,
			postedTime:
				Date.parse(crossing ? "2026-11-09T10:00:00Z" : "2026-11-13T12:00:00Z") /
				1000,
			enabled: true,
		},
	];
	if (crossing) {
		transactions.push({
			id: "01900000-0000-7000-8000-00000000e008",
			name: "Synthetic unlinked income category",
			sourceAccountId: null,
			destinations: [checkingId],
			amount: amount(32.11),
			transactionTime: Date.parse("2026-11-08T13:00:00Z") / 1000,
			postedTime: Date.parse("2026-11-08T13:00:00Z") / 1000,
			enabled: true,
		});
		transactions.push({
			id: "01900000-0000-7000-8000-00000000e007",
			name: "Synthetic received income",
			sourceAccountId: null,
			destinations: [checkingId],
			amount: amount(150),
			claim: { scheduleId: "evidence-salary", occurrenceDate: "2026-11-08" },
			transactionTime: Date.parse("2026-11-08T12:00:00Z") / 1000,
			postedTime: Date.parse("2026-11-08T12:00:00Z") / 1000,
			enabled: true,
		});
		for (const [suffix, name, time] of [
			["e005", "Synthetic crossing purchase", "12:00:00"],
			["e006", "Synthetic later purchase", "15:00:00"],
		]) {
			transactions.push({
				id: `01900000-0000-7000-8000-00000000${suffix}`,
				name,
				sourceAccountId: "evidence-card",
				destinations: [],
				amount: amount(200),
				transactionTime: Date.parse(`2026-11-09T${time}Z`) / 1000,
				postedTime: Date.parse(`2026-11-09T${time}Z`) / 1000,
				enabled: true,
			});
		}
	}
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
	expect(await imported.json()).toMatchObject({ saved: true });
	if (crossing) {
		const categorized = await api.post(
			`${FIXTURE_API}/v1/transactions/01900000-0000-7000-8000-00000000e007/categorize`,
			{ data: { category: "INCOME" } },
		);
		expect(categorized.ok(), await categorized.text()).toBe(true);
		const unlinkedCategory = await api.post(
			`${FIXTURE_API}/v1/transactions/01900000-0000-7000-8000-00000000e008/categorize`,
			{ data: { category: "INCOME" } },
		);
		expect(unlinkedCategory.ok(), await unlinkedCategory.text()).toBe(true);
	}
	const heldPayment = baseline.transactions.find(
		(row: { name: string }) => row.name === "Synthetic held payment",
	);
	if (pending)
		expect(heldPayment).toMatchObject({
			pending: true,
			enabled: false,
			sourceAccountId: checkingId,
		});
	const observations = await api.post(
		`${FIXTURE_API}/__fixture/cash-observations`,
		{
			data: {
				checkpoints: [
					{
						accountId: checkingId,
						postedBalance: 1608.05,
						availableBalance: 1244.43,
						observedAt: OBSERVED_AT,
					},
				],
			},
		},
	);
	expect(observations.ok(), await observations.text()).toBe(true);
	expect(await observations.json()).toMatchObject({
		saved: true,
		observations: 1,
	});
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			statementDay: 20,
			statementDaySet: true,
			reserve: 0,
			accountIds: ["evidence-card"],
			spendingAccountIds: [checkingId],
			incomeScheduleIds: ["evidence-salary"],
			transactionIds: pending
				? [
						"evidence-today-a",
						"evidence-today-b",
						"evidence-future-a",
						"evidence-future-b",
						"evidence-future-c",
						heldPayment.id,
					]
				: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

test("cash uses per-account evidence and outstanding bills, not future income or historical fallback", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api);
		const response = await api.get(
			`${FIXTURE_API}/v1/safe-spending-summary?start=${AS_OF}&end=2026-11-30`,
		);
		expect(response.ok(), await response.text()).toBe(true);
		expect(response.headers()["cache-control"]).toContain("no-store");
		const summary = await response.json();
		expect(summary).toMatchObject({
			start: AS_OF,
			end: "2026-11-30",
			selectedAccountIds: ["evidence-checking"],
			status: "available",
			checkingAvailable: 1244.43,
			outstandingBillsTotal: 1461.01,
			cashAfterBills: -216.58,
			// The October settlement is already inside November's observation.
			confirmedMovements: [],
			baselines: [
				{
					accountId: "evidence-checking",
					observedAt: OBSERVED_AT,
					postedBalance: 1608.05,
					availableBalance: 1244.43,
					basis: "available",
				},
			],
		});
		expect(summary.outstandingObligations).toHaveLength(5);
		expect(summary.outstandingObligations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scheduleId: "evidence-today-a",
					date: AS_OF,
					amount: 711.12,
				}),
				expect.objectContaining({
					scheduleId: "evidence-today-b",
					date: AS_OF,
					amount: 98.92,
				}),
			]),
		);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		const browserSummary = page.waitForResponse(isCurrentSummary);
		await page.goto("/outlook");
		expect(await (await browserSummary).json()).toMatchObject({
			checkingAvailable: 1244.43,
			cashAfterBills: -216.58,
		});
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(
			card.getByText("Cash after bills", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
		await expect(card.locator("details")).toHaveCount(0);
		await expect(card.getByLabel("Cash account observations")).toHaveCount(0);
		await expect(card.getByLabel("Confirmed cash movements")).toHaveCount(0);
		await expect(card).not.toContainText("income excluded");
		await expect(card).not.toContainText("Card allowance · separate from cash");
		await expect(card).not.toContainText(
			/The .+ paychecks? (pays|pay|paid) this statement/,
		);
		await expect(
			card.getByRole("heading", { name: "Bills", exact: true }),
		).toBeVisible();
		await expect(
			card
				.getByRole("list", { name: "Bills in this cycle" })
				.getByRole("listitem"),
		).toHaveCount(2);
		await expect(
			card.getByText("Synthetic later bill A", { exact: true }),
		).toHaveCount(0);
		await expect(
			card.getByText("Synthetic due today A", { exact: true }),
		).toBeVisible();
		await expect(
			card.getByText("Synthetic due today B", { exact: true }),
		).toBeVisible();
		await expect(card.getByText("$1,244.43", { exact: true })).toBeVisible();
		await expect(
			card.getByLabel("Spending pace", { exact: true }),
		).toBeVisible();
		await card
			.getByRole("button", { name: "Previous cycle", exact: true })
			.click();
		// Every offset lists the same main-card sections: cash evidence with
		// the selected window's Bills, and pace.
		await expect(card.getByTestId("left-value")).toHaveText("—");
		await expect(
			card.getByText("Remainder unavailable", { exact: true }),
		).toBeVisible();
		await expect(
			card.getByRole("heading", { name: "Bills", exact: true }),
		).toBeVisible();
		await expect(card.getByText("No bills.", { exact: true })).toBeVisible();
		await expect(
			card.getByLabel("Spending pace", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("closed-card-value")).toHaveCount(0);
		await expect(card.getByTestId("close-cash-value")).toHaveCount(0);
		await expect(card.getByTestId("recorded-charges-value")).toHaveCount(0);
		await expect(card.getByTestId("cash-payments-value")).toHaveCount(0);
		await expect(card).not.toContainText("Closed card balance");
		await expect(card).not.toContainText("No balance recorded at close");
		const inlinePayment = card.getByText("Synthetic one-time card settlement", {
			exact: true,
		});
		await expect(inlinePayment).toHaveCount(0);
		await expect(card.locator("details")).toHaveCount(0);
		await card
			.getByRole("button", { name: "Transactions", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		const drawer = page.getByRole("dialog", {
			name: "Safe spending",
			exact: true,
		});
		// One side-panel shape for every offset.
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(drawer).toContainText("Sep 20 – Oct 19");
		// The unified summary lists the spent total before the per-card rows.
		await expect(
			drawer.getByText("$125.00", { exact: true }).first(),
		).toBeVisible();
		const paymentRow = drawer.getByText("Synthetic one-time card settlement", {
			exact: true,
		});
		await expect(
			drawer.getByText("Cash payments this cycle", { exact: true }),
		).toBeVisible();
		await expect(drawer).toContainText("$80.00");
		await expect(paymentRow).toBeVisible();
		await drawer
			.getByRole("button", { name: /Synthetic one-time card settlement on/ })
			.click();
		const inspection = page.getByRole("dialog", {
			name: "Synthetic one-time card settlement",
			exact: true,
		});
		await expect(inspection).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(inspection).toBeHidden();
		await expect(drawer).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
		await expect(inlinePayment).toHaveCount(0);
		await expect(card).not.toContainText(/[-−]\$1,385/);
		await expect(
			card.getByLabel("Spending pace", { exact: true }),
		).toBeVisible();
		// Next offset lists the same main-card sections with unavailable future cash.
		await card.getByRole("button", { name: "Next cycle", exact: true }).click();
		await card.getByRole("button", { name: "Next cycle", exact: true }).click();
		await expect(card.getByTestId("left-value")).toHaveText("—");
		await expect(
			card.getByRole("heading", { name: "Bills", exact: true }),
		).toBeVisible();
		await expect(
			card.getByLabel("Spending pace", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("closed-card-value")).toHaveCount(0);
		await expect(card.getByTestId("cash-payments-value")).toHaveCount(0);
		await expect(card.getByTestId("recorded-charges-value")).toHaveCount(0);
		await card
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(drawer).toContainText("No spending this cycle yet.");
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
		const historical = await api.get(
			`${FIXTURE_API}/v1/safe-spending-summary?start=2026-10-19&end=2026-10-19`,
		);
		expect(historical.ok()).toBe(true);
		expect(await historical.json()).toMatchObject({
			start: "2026-10-19",
			end: "2026-10-19",
			checkingAvailable: null,
		});
	} finally {
		await api.dispose();
	}
});

test("included bill changes refresh cash evidence without reloading", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		const initialResponse = page.waitForResponse(isCurrentSummary);
		await page.goto("/outlook");
		const initial = await (await initialResponse).json();
		expect(initial).toMatchObject({
			checkingAvailable: 1244.43,
			outstandingBillsTotal: 1461.01,
			cashAfterBills: -216.58,
		});
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
		for (const included of [false, true]) {
			await card
				.getByRole("button", { name: "Configure", exact: true })
				.click();
			const drawer = page.getByRole("dialog", {
				name: "Safe spending",
				exact: true,
			});
			const bill = drawer.getByRole("button", {
				name: /Synthetic due today A/,
			});
			await expect(bill).toHaveAttribute("aria-pressed", String(!included));
			const saved = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === "/v1/safe-spending-settings" &&
					response.request().method() === "PUT",
			);
			const refreshed = page.waitForResponse(async (response) => {
				if (!isCurrentSummary(response) || !response.ok()) return false;
				return (
					(await response.json()).cashAfterBills ===
					(included ? -216.58 : 494.54)
				);
			});
			await bill.click();
			expect((await saved).ok()).toBe(true);
			await expect(bill).toHaveAttribute("aria-pressed", String(included));
			expect(await (await refreshed).json()).toMatchObject({
				revision: initial.revision,
				checkingAvailable: 1244.43,
				outstandingBillsTotal: included ? 1461.01 : 749.89,
				cashAfterBills: included ? -216.58 : 494.54,
			});
			await page.keyboard.press("Escape");
			await expect(drawer).toBeHidden();
			await expect(card.getByTestId("left-value")).toHaveText(
				included ? /[-−]\$216\.58/ : "$494.54",
			);
			await expect(
				card.getByText("Synthetic due today A", { exact: true }),
			).toHaveCount(included ? 1 : 0);
			await expect(
				card.getByText("Synthetic due today B", { exact: true }),
			).toBeVisible();
		}
	} finally {
		await api.dispose();
	}
});

test("current cash budget and over-limit state survive inline history, sorting and future salary changes", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api, false, true);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", {
			name: "Safe spending",
			exact: true,
		});
		const checkCurrent = async (limit = "8,702.77") => {
			await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
			await expect(
				card.getByLabel("Spending pace", { exact: true }).locator("desc"),
			).toHaveText(
				new RegExp(`The \\$${limit} cash limit is not reached this cycle`),
			);
			await expect(
				card.getByRole("list", { name: "Spending pace legend" }),
			).toContainText("Income limit");
			await expect(
				card.getByLabel("Spending pace", { exact: true }).locator("desc"),
			).toHaveText(/Income this month: \$/);
			const chart = card.getByLabel("Spending pace", { exact: true });
			await expect(
				chart.locator("text").filter({ hasText: /^Oct / }).first(),
			).toBeVisible();
			const axisDates = (await chart.locator("text").allTextContents())
				.filter((text) => /^(Oct|Nov) \d{1,2}$/.test(text))
				.map(
					(text) =>
						(text.startsWith("Oct") ? 1000 : 1100) + Number(text.split(" ")[1]),
				);
			expect(axisDates.length).toBeGreaterThan(2);
			expect(axisDates[0]).toBeLessThan(1100);
			expect(axisDates.at(-1)).toBeGreaterThan(1100);
			expect(axisDates).toEqual([...axisDates].sort((a, b) => a - b));
		};
		await checkCurrent();
		await card
			.getByRole("button", { name: "Previous cycle", exact: true })
			.click();
		// Identical main-card sections for the past window, with close cash
		// unavailable in this fixture.
		await expect(card.getByTestId("left-value")).toHaveText("—");
		await expect(
			card.getByRole("heading", { name: "Bills", exact: true }),
		).toBeVisible();
		await expect(
			card.getByLabel("Spending pace", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("closed-card-value")).toHaveCount(0);
		await expect(card.getByTestId("cash-payments-value")).toHaveCount(0);
		await expect(card.getByTestId("recorded-charges-value")).toHaveCount(0);
		const drawer = page.getByRole("dialog", {
			name: "Safe spending",
			exact: true,
		});
		await card
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		await expect(
			drawer.getByRole("heading", { name: "Spending this cycle" }),
		).toBeVisible();
		await expect(drawer).toContainText("Sep 20 – Oct 19");
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
		await card.getByRole("button", { name: "Next cycle", exact: true }).click();
		await checkCurrent();
		// Identical main-card sections for the future window.
		await card.getByRole("button", { name: "Next cycle", exact: true }).click();
		await expect(card.getByTestId("left-value")).toHaveText("—");
		await expect(
			card.getByRole("heading", { name: "Bills", exact: true }),
		).toBeVisible();
		await expect(
			card.getByLabel("Spending pace", { exact: true }),
		).toBeVisible();
		await card
			.getByRole("button", { name: "Previous cycle", exact: true })
			.click();
		await checkCurrent();
		await card
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		const checkCrossing = async () => {
			const table = drawer.getByRole("table");
			await expect(table.locator("tbody > tr")).toHaveCount(3);
			await expect(table.getByRole("separator")).toHaveCount(0);
			// The income-backed limit sits far above spent, so no
			// crossing marker is assigned.
			await expect(
				table.getByRole("row").filter({ hasText: "Cash limit" }),
			).toHaveCount(0);
			await expect(drawer.locator("[data-spending-divider]")).toHaveCount(0);
		};
		await checkCrossing();
		await drawer.getByRole("button", { name: "Newest first" }).click();
		await checkCrossing();
		await page.keyboard.press("Escape");
		await checkCurrent();
		const changed = await api.post(
			`${FIXTURE_API}/v1/schedules/evidence-salary/amend`,
			{ data: { amount: amount(99999.99) } },
		);
		expect(changed.ok(), await changed.text()).toBe(true);
		await page.reload();
		await checkCurrent("101,244.42");
		await card
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		await checkCrossing();
		await page.keyboard.press("Escape");
		await card.getByRole("button", { name: "Configure", exact: true }).click();
		await expect(
			drawer.getByText("Recurring income sources", { exact: true }),
		).toBeVisible();
		await expect(
			drawer.getByText("Income accounts", { exact: true }),
		).toHaveCount(0);
		await page.keyboard.press("Escape");
		await page.route("**/v1/safe-spending-summary?**", async (route) => {
			const response = await route.fetch();
			const body = await response.json();
			await route.fulfill({
				response,
				json: { ...body, status: "uncertain", cashAfterBills: null },
			});
		});
		await page.reload();
		await card
			.getByRole("button", { name: "Transactions", exact: true })
			.click();
		await expect(drawer.getByRole("table").locator("tbody > tr")).toHaveCount(
			3,
		);
		await expect(drawer.locator("[data-spending-divider]")).toHaveCount(0);
	} finally {
		await api.dispose();
	}
});

test("Configure preserves explicit recurring sources and prices their November occurrences", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api, false, true);
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", {
			name: "Safe spending",
			exact: true,
		});
		const drawer = page.getByRole("dialog", {
			name: "Safe spending",
			exact: true,
		});
		const legend = card.getByRole("list", { name: "Spending pace legend" });
		await expect(legend).toContainText("Income limit");
		const cashBefore = await card.getByTestId("left-value").textContent();
		await card.getByRole("button", { name: "Configure", exact: true }).click();
		const payroll = drawer.getByRole("button", {
			name: /Synthetic future salary/,
		});
		const other = drawer.getByRole("button", {
			name: /Synthetic other income/,
		});
		await expect(payroll).toHaveAttribute("aria-pressed", "true");
		await expect(other).toHaveAttribute("aria-pressed", "false");
		const toggle = async (button: typeof payroll) => {
			const saved = page.waitForResponse(
				(response) =>
					response.url().includes("/v1/safe-spending-settings") &&
					response.request().method() === "PUT",
			);
			await button.click();
			expect((await saved).ok()).toBe(true);
		};
		await toggle(payroll);
		await page.keyboard.press("Escape");
		await expect(legend).not.toContainText("Income limit");
		await expect(card.getByTestId("left-value")).toHaveText(cashBefore!);
		await card.getByRole("button", { name: "Configure", exact: true }).click();
		await toggle(other);
		await page.keyboard.press("Escape");
		await page.reload();
		await expect(legend).toContainText("Income limit");
		await expect(card.getByTestId("left-value")).toHaveText(cashBefore!);
		await card.getByRole("button", { name: "Configure", exact: true }).click();
		await expect(payroll).toHaveAttribute("aria-pressed", "false");
		await expect(other).toHaveAttribute("aria-pressed", "true");
		await toggle(payroll);
		await page.keyboard.press("Escape");
		await page.reload();
		await expect(legend).toContainText("Income limit");
		await expect(card.getByTestId("left-value")).toHaveText(cashBefore!);
		const settings = await api.get(`${FIXTURE_API}/v1/safe-spending-settings`);
		expect(await settings.json()).toMatchObject({
			settings: {
				incomeScheduleIds: ["evidence-other-income", "evidence-salary"],
			},
		});
	} finally {
		await api.dispose();
	}
});

test("an older unclaimed pending payment preserves observed cash without subtracting a hold twice", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedEvidence(api, true);
		const response = await api.get(
			`${FIXTURE_API}/v1/safe-spending-summary?start=${AS_OF}&end=2026-11-30`,
		);
		expect(response.ok(), await response.text()).toBe(true);
		const summary = await response.json();
		expect(summary).toMatchObject({
			status: "available",
			checkingAvailable: 1244.43,
			cashAfterBills: -216.58,
			outstandingBillsTotal: 1461.01,
			baselines: [
				{
					accountId: "checking",
					observedAt: OBSERVED_AT,
					availableBalance: 1244.43,
					status: "available",
				},
			],
		});
		expect(
			summary.outstandingObligations.filter(
				(row: { name: string }) => row.name === "Synthetic held payment",
			),
		).toEqual([]);
		expect(summary.outstandingObligations).toHaveLength(5);
		for (const row of summary.outstandingObligations) {
			expect(row.date >= AS_OF && row.date <= "2026-11-30").toBe(true);
		}
		await page.clock.setFixedTime(new Date(`${AS_OF}T12:00:00Z`));
		await page.goto("/outlook");
		const card = page.getByRole("region", { name: "Safe spending" });
		await expect(
			card.getByText("Cash after bills", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
		await expect(
			card.getByText("Available cash", { exact: true }),
		).toBeVisible();
		await expect(card.getByText("$1,244.43", { exact: true })).toBeVisible();
		await expect(card.getByLabel("Cash account observations")).toHaveCount(0);
	} finally {
		await api.dispose();
	}
});
