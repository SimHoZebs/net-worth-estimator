import { expect, request, test, type APIRequestContext } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const CARD_ID = "synthetic-synced-card";
const BRIDGE_ID = "sf2.synthetic.card";

// Synthetic-only: a bank-synced account keeps the neutral cash kind, is marked
// read-only by its link, and is explicitly tracked as a card. This mirrors the
// production shape without using any private record.
async function seedTrackedCard(api: APIRequestContext) {
	const read = await api.get(`${FIXTURE_API}/v1/financial-model`);
	expect(read.ok()).toBe(true);
	const { model: baseline } = await read.json();
	const card = {
		id: CARD_ID,
		name: "Synthetic synced card",
		kind: "cash",
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
			reserve: 200,
			accountIds: [CARD_ID],
			spendingAccountIds: [],
			incomeScheduleIds: [],
			transactionIds: null,
		},
	});
	expect(settings.ok(), await settings.text()).toBe(true);
}

test("a tracked synced cash card saves its closing day through the real API", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedTrackedCard(api);
		await page.goto(`/accounts/${CARD_ID}`);
		await page.getByRole("tab", { name: "Details" }).click();
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
