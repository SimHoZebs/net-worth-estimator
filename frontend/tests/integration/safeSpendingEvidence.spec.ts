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
async function seedEvidence(api: APIRequestContext, pending = false) {
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
		frequency: "monthly",
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
			sourceAccountId: null,
			destinations: [checkingId],
		},
	];
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
	expect(await imported.json()).toMatchObject({ saved: true });
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
			incomeAccountIds: [checkingId],
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
		const card = page.getByRole("region", { name: "Safe card spending" });
		await expect(
			card.getByText("Cash after outstanding bills", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
		const details = card.locator("summary").filter({ hasText: /^Details$/ });
		await expect(card.getByLabel("Cash account observations")).toBeHidden();
		await details.focus();
		await page.keyboard.press("Enter");
		await expect(card.getByLabel("Cash account observations")).toBeVisible();
		await expect(
			card.getByText("Posted $1,608.05 · Available $1,244.43"),
		).toBeVisible();
		await page.keyboard.press("Space");
		await expect(card.getByLabel("Cash account observations")).toBeHidden();
		const bills = card.locator("summary").filter({ hasText: /^Bills / });
		await expect(
			card.getByText("Synthetic due today A", { exact: true }),
		).toBeHidden();
		await bills.focus();
		await page.keyboard.press("Enter");
		await expect(
			card.getByText("Synthetic due today A", { exact: true }),
		).toBeVisible();
		await expect(
			card.getByText("Synthetic due today B", { exact: true }),
		).toBeVisible();
		await expect(card).toContainText("Synthetic checking");
		await expect(card).toContainText(/Nov 14/);
		await expect(card).toContainText(/available/i);
		await expect(card.getByText("Cash accounts", { exact: true })).toHaveCount(
			0,
		);
		await expect(card.getByRole("img", { name: /^Cash balance / })).toHaveCount(
			0,
		);
		await expect(
			card.getByLabel("Card spending pace", { exact: true }),
		).toBeVisible();
		await card.getByRole("button", { name: "Last cycle", exact: true }).click();
		await expect(card.getByTestId("recorded-charges-value")).toHaveText(
			/\$125(?:\.00)?/,
		);
		await expect(card.getByTestId("closed-card-value")).toHaveCount(0);
		await expect(
			card.getByText("No balance recorded at close", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("close-cash-value")).toHaveCount(0);
		await expect(card.getByTestId("cash-payments-value")).toHaveText("$80.00");
		const inlinePayment = card.getByText("Synthetic one-time card settlement", {
			exact: true,
		});
		await expect(inlinePayment).toHaveCount(0);
		await card
			.locator("summary")
			.filter({ hasText: /^Details$/ })
			.click();
		await expect(inlinePayment).toHaveCount(0);
		await card
			.getByRole("button", { name: "Last cycle transactions", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		const drawer = page.getByRole("dialog", {
			name: "Safe card spending",
			exact: true,
		});
		const paymentRow = drawer.getByText("Synthetic one-time card settlement", {
			exact: true,
		});
		await expect(
			drawer.getByText("Cash payments this cycle", { exact: true }),
		).toBeVisible();
		await expect(drawer).toContainText("Sep 20 – Oct 19");
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
			card.getByLabel("Card spending pace", { exact: true }),
		).toBeVisible();
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
		const card = page.getByRole("region", { name: "Safe card spending" });
		await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
		for (const included of [false, true]) {
			await card
				.getByRole("button", { name: "Configure", exact: true })
				.click();
			const drawer = page.getByRole("dialog", {
				name: "Safe card spending",
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
			if (
				!(await card
					.getByText("Synthetic due today B", { exact: true })
					.isVisible())
			)
				await card
					.locator("summary")
					.filter({ hasText: /^Bills / })
					.click();
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
		const card = page.getByRole("region", { name: "Safe card spending" });
		await expect(
			card.getByText("Cash after outstanding bills", { exact: true }),
		).toBeVisible();
		await expect(card.getByTestId("left-value")).toHaveText(/[-−]\$216\.58/);
		await expect(
			card.getByText("Available cash", { exact: true }),
		).toBeVisible();
		await expect(card.getByText("$1,244.43", { exact: true })).toBeVisible();
		await expect(card.getByLabel("Cash account observations")).toBeHidden();
	} finally {
		await api.dispose();
	}
});
