import { expect, request, test, type APIRequestContext } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const CARD_ID = "synthetic-synced-card";
const BRIDGE_ID = "sf2.synthetic.card";

// The bank owns observed data, while the owner sets the closing day.
async function seedTrackedCard(api: APIRequestContext) {
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const card = {
		id: CARD_ID,
		name: "Synthetic synced card",
		kind: "credit_card",
		enabled: true,
		minBalance: 0,
		maxBalance: null,
		statementClosingDay: 19,
		color: "#2f6f4f",
		display: {
			name: "Synthetic synced card",
			components: [{ accountId: CARD_ID, role: "primary" }],
			interestScheduleId: "",
			paymentScheduleId: "",
		},
	};
	const imported = await api.post(`${FIXTURE_API}/v1/model/import`, {
		data: { model: { ...baseline, accounts: [...baseline.accounts, card] } },
	});
	expect(imported.ok(), await imported.text()).toBe(true);
	const observed = await api.post(
		`${FIXTURE_API}/__fixture/cash-observations`,
		{
			data: {
				checkpoints: [
					{
						accountId: CARD_ID,
						postedBalance: -125,
						observedAt: Date.parse("2026-01-01T00:00:00Z") / 1000,
					},
				],
			},
		},
	);
	expect(observed.ok(), await observed.text()).toBe(true);
	const linked = await api.put(
		`${FIXTURE_API}/v1/sync/simplefin/accounts/${BRIDGE_ID}`,
		{ data: { modelAccountId: CARD_ID } },
	);
	expect(linked.ok(), await linked.text()).toBe(true);
	const settings = await api.put(`${FIXTURE_API}/v1/safe-spending-settings`, {
		data: {
			accountIds: [CARD_ID],
			spendingAccountIds: [],
			incomeScheduleIds: [],
			transactionIds: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

test("a synced credit card saves its closing day through the real API", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedTrackedCard(api);
		await page.goto(`/accounts/${CARD_ID}`);
		await page.getByRole("tab", { name: "Account details" }).click();
		const closing = page.getByLabel(/Statement closing day of the month/i);
		await expect(closing).toBeVisible();
		expect(await closing.getAttribute("readonly")).toBeNull();

		const saved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname.includes(`/accounts/${CARD_ID}`) &&
				response.request().method() === "PATCH",
		);
		await closing.fill("27");
		await page.getByRole("button", { name: "Save changes" }).click();
		expect((await saved).status()).toBe(200);
		await expect(closing).toHaveValue("27");

		const modelResponse = await api.get(`${FIXTURE_API}/v1/financial-model`);
		expect(modelResponse.ok()).toBe(true);
		const { model } = await modelResponse.json();
		const stored = model.accounts.find(
			(account: { id: string }) => account.id === CARD_ID,
		);
		expect(stored.statementClosingDay).toBe(27);
	} finally {
		await api.dispose();
	}
});

test("a saved statement appears on its card and is only paid after applying the transaction", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedTrackedCard(api);
		const payment = await api.post(`${FIXTURE_API}/v1/transactions`, {
			data: {
				name: "Synthetic card payoff",
				sourceAccountId: "checking",
				destinations: [CARD_ID],
				amount: { value: 125.55 },
				date: "2026-02-01",
				enabled: true,
			},
		});
		expect(payment.ok(), await payment.text()).toBe(true);

		await page.goto(`/accounts/${CARD_ID}`);
		await page.getByRole("tab", { name: "Account details" }).click();
		await page.getByRole("button", { name: "Add statement" }).click();
		await page
			.getByLabel("Statement close", { exact: true })
			.fill("2026-01-19");
		await page.getByLabel("Statement balance").fill("125.55");
		await page.getByLabel("Due date").fill("2026-02-03");
		await page.getByRole("button", { name: "Save statement" }).click();

		const statements = page.getByRole("region", { name: "Card statements" });
		await expect(
			statements.getByText("$125.55 remaining · Open"),
		).toBeVisible();

		await page.goto("/transactions");
		await page
			.getByRole("textbox", { name: "Search transactions" })
			.fill("Synthetic card payoff");
		await page
			.getByRole("button", { name: /View Synthetic card payoff/ })
			.click();
		await page.getByRole("button", { name: "Review 1 suggestion" }).click();
		await expect(
			page.getByText("Payment matches the remaining statement balance."),
		).toBeVisible();
		await page.getByRole("button", { name: /^Apply \$125\.55/ }).click();
		await page.getByRole("button", { name: "Done", exact: true }).click();
		await expect(page.getByText(/Paid in full\./)).toBeVisible();

		await page.getByRole("button", { name: "Undo statement payment" }).click();
		await expect(
			page.getByRole("button", { name: "Review 1 suggestion" }),
		).toBeVisible();
		await page.goto(`/accounts/${CARD_ID}`);
		await page.getByRole("tab", { name: "Account details" }).click();
		await expect(
			statements.getByText("$125.55 remaining · Open"),
		).toBeVisible();
	} finally {
		await api.dispose();
	}
});
