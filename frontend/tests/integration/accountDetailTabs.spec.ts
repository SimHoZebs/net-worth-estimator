import { expect, request, test, type APIRequestContext } from "./base.ts";
import { FIXTURE_API } from "./fixture.ts";

const CARD_ID = "tabs-statements-card";

// A recorded cycle end derives one statement, so the Card statements region
// has real content to compare between the Statements and Details panels.
async function seedDerivedCard(api: APIRequestContext) {
	const closeInstant = Math.floor(Date.parse("2026-01-31T23:59:59Z") / 1000);
	const card = await api.post(`${FIXTURE_API}/v1/accounts`, {
		data: {
			id: CARD_ID,
			name: "Tabs statements card",
			kind: "credit_card",
			enabled: true,
			statementClosingDay: 31,
			balance: -125.55,
			observedAt: closeInstant,
		},
	});
	expect(card.ok(), await card.text()).toBe(true);
	const terms = await api.post(`${FIXTURE_API}/v1/payment-terms`, {
		data: { accountId: CARD_ID, minimumFixed: 25, dueDay: 20 },
	});
	expect(terms.ok(), await terms.text()).toBe(true);
	const payment = await api.post(`${FIXTURE_API}/v1/transactions`, {
		data: {
			name: "Tabs card payoff",
			sourceAccountId: "checking",
			destinations: [CARD_ID],
			amount: { value: 125.55 },
			date: "2026-02-01",
			enabled: true,
		},
	});
	expect(payment.ok(), await payment.text()).toBe(true);
}

test("card detail renders Card statements in a Statements tab before Details", async ({
	page,
}) => {
	const api = await request.newContext();
	try {
		await seedDerivedCard(api);
		await page.goto(`/accounts/${CARD_ID}`);
		const tabs = page.getByRole("tablist", { name: "Account view" });
		const details = tabs.getByRole("tab", { name: "Details", exact: true });
		const statements = tabs.getByRole("tab", {
			name: "Statements",
			exact: true,
		});
		await expect(details).toBeVisible();
		await expect(statements).toBeVisible();
		await expect(
			tabs.getByRole("tab", { name: "Account details" }),
		).toHaveCount(0);

		const statementsBox = await statements.boundingBox();
		const detailsBox = await details.boundingBox();
		expect(statementsBox).not.toBeNull();
		expect(detailsBox).not.toBeNull();
		expect(statementsBox!.x).toBeLessThan(detailsBox!.x);

		await statements.click();
		const cardStatements = page.getByRole("region", {
			name: "Card statements",
		});
		await expect(cardStatements).toBeVisible();
		await expect(
			cardStatements.getByText("Card statement").first(),
		).toBeVisible();
		await expect(cardStatements.getByText("Jan 31, 2026")).toHaveCount(2);
		await expect(cardStatements.getByText("$125.55 remaining")).toBeVisible();
		await expect(
			cardStatements.getByText("Open", { exact: true }),
		).toBeVisible();

		await details.click();
		await expect(details).toHaveAttribute("aria-selected", "true");
		await expect(cardStatements).toHaveCount(0);
		await expect(
			page.getByLabel(/Statement closing day of the month/i),
		).toBeVisible();
	} finally {
		await api.dispose();
	}
});

test("non-card account keeps three tabs with no Statements tab", async ({
	page,
}) => {
	await page.goto("/accounts/checking");
	const tabs = page.getByRole("tablist", { name: "Account view" });
	await expect(tabs.getByRole("tab")).toHaveCount(3);
	await expect(tabs.getByRole("tab", { name: "Transactions" })).toBeVisible();
	await expect(tabs.getByRole("tab", { name: "Recurring" })).toBeVisible();
	await expect(
		tabs.getByRole("tab", { name: "Details", exact: true }),
	).toBeVisible();
	await expect(tabs.getByRole("tab", { name: "Statements" })).toHaveCount(0);
	await expect(tabs.getByRole("tab", { name: "Account details" })).toHaveCount(
		0,
	);
});
