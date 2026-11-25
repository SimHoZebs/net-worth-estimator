import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialModel } from "../api/contracts.ts";
import { modelFixture, stubTestServer } from "./waypointServer.ts";

const instant = (value: string) => Date.parse(value) / 1000;

function actual(
	id: string,
	amount: number,
	at: string,
	overrides: Partial<FinancialModel["transactions"][number]> = {},
): FinancialModel["transactions"][number] {
	return {
		id,
		name: id,
		sourceAccountId: "cash",
		destinations: null,
		amount: { resolver: "expression", config: { expression: String(amount) } },
		postedTime: instant(at),
		transactionTime: instant(at),
		enabled: true,
		source: "user",
		pending: false,
		void: false,
		...overrides,
	} as FinancialModel["transactions"][number];
}

async function balances(
	server: ReturnType<typeof stubTestServer>,
	asOf?: string,
) {
	const response = await server.fetcher(
		`/v1/accounts/balances${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`,
		{ method: "GET" },
	);
	expect(response.status).toBe(200);
	return response.json();
}

afterEach(() => vi.useRealTimers());

describe("mock balance rows", () => {
	it("defaults a date-insensitive read to today's UTC date", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
		const server = stubTestServer();
		const body = await balances(server);
		expect(body.asOf).toBe("2026-11-25");
	});

	it("replays only recorded actuals after each account's latest checkpoint", async () => {
		const model = modelFixture();
		model.checkpoints = [
			{
				AccountId: "cash",
				Balance: 100,
				observedAt: instant("2026-01-01T10:00:00Z"),
			},
			{
				AccountId: "loan",
				Balance: -40,
				observedAt: instant("2026-01-01T10:00:00Z"),
			},
		];
		model.transactions = [
			actual("before-checkpoint", 10, "2025-12-31T12:00:00Z"),
			actual("same-instant", 5, "2026-01-01T10:00:00Z"),
			actual("later-expense", 25, "2026-01-02T11:00:00Z"),
			actual("later-income", 40, "2026-01-03T12:00:00Z", {
				sourceAccountId: null,
				destinations: ["cash"],
			}),
			actual("disabled", 999, "2026-01-04T12:00:00Z", { enabled: false }),
		];
		const server = stubTestServer(undefined, model);

		const before = await balances(server, "2026-01-02T10:59:59Z");
		expect(
			before.accounts.find((row: { id: string }) => row.id === "cash"),
		).toMatchObject({
			balance: 100,
			observedBalance: 100,
			observedAt: instant("2026-01-01T10:00:00Z"),
		});

		const exact = await balances(server, "2026-01-02T11:00:00Z");
		expect(
			exact.accounts.find((row: { id: string }) => row.id === "cash"),
		).toMatchObject({
			balance: 75,
			observedBalance: 100,
		});

		const current = await balances(server, "2026-01-31");
		expect(
			current.accounts.find((row: { id: string }) => row.id === "cash"),
		).toMatchObject({
			balance: 115,
			observedBalance: 100,
		});
		expect(
			current.accounts.find((row: { id: string }) => row.id === "loan"),
		).toMatchObject({
			balance: -40,
			observedBalance: -40,
		});
	});
});
