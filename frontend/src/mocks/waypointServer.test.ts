import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountBalanceRow } from "../api/generated/model/accountBalanceRow.ts";
import {
	defaultAccountBalanceFixture,
	modelFixture,
	stubTestServer,
} from "./waypointServer.ts";

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

describe("mock balance responses", () => {
	it("defaults a date-insensitive read to today's UTC date", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
		const server = stubTestServer();
		const body = await balances(server);
		expect(body.asOf).toBe("2026-11-25");
	});

	it("serves explicit active and archived fixtures without replaying the model", async () => {
		const model = modelFixture();
		model.accounts.push({
			...model.accounts[1]!,
			id: "active-loan",
			name: "Active loan",
		});
		const fixture: AccountBalanceRow[] = [
			{ ...defaultAccountBalanceFixture[0]!, balance: 100 },
			{
				...defaultAccountBalanceFixture[1]!,
				balance: 0,
				observedBalance: 0,
				archived: true,
			},
			{
				...defaultAccountBalanceFixture[1]!,
				id: "active-loan",
				name: "Active loan",
				balance: 0,
				observedBalance: 0,
				archived: false,
			},
		];
		const server = stubTestServer(undefined, model, fixture);

		const body = await balances(server, "2026-11-25");
		expect(body.accounts).toEqual(fixture);
		expect(
			body.accounts.find((row: AccountBalanceRow) => row.id === "loan"),
		).toMatchObject({ archived: true, balance: 0 });
		expect(
			body.accounts.find((row: AccountBalanceRow) => row.id === "active-loan"),
		).toMatchObject({ archived: false, balance: 0 });
	});

	it("serves an explicit fixture for a requested cut", async () => {
		const server = stubTestServer();
		server.setBalanceRowsForCut("2026-01-01T12:00:00Z", [
			{
				...defaultAccountBalanceFixture[0]!,
				balance: 0,
				observedBalance: 0,
				hasCheckpoint: false,
				observedAt: undefined,
			},
		]);
		const body = await balances(server, "2026-01-01T12:00:00Z");
		expect(body.asOf).toBe("2026-01-01");
		expect(body.accounts[0]).toMatchObject({ id: "cash", balance: 0 });
		expect((await balances(server)).accounts[0]).toMatchObject({
			id: "cash",
			balance: 100,
		});
	});

	it("keeps malformed-cut errors at the transport boundary", async () => {
		const server = stubTestServer();
		const response = await server.fetcher(
			"/v1/accounts/balances?asOf=not-a-cut",
			{ method: "GET" },
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toMatchObject({
			detail: "as-of cut must be a valid date or timestamp",
		});
	});
});
