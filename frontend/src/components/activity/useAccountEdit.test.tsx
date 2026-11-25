import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountBalanceRow } from "../../api/generated/model/accountBalanceRow.ts";
import type { FinancialModel } from "../../api/contracts.ts";
import type { Account } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import {
	setupQueryScope,
	ServerQueryWrapper,
	teardownQueryScope,
} from "../../mocks/testScope.tsx";
import { serverQueryClient } from "../../state/serverQuery.ts";
import {
	balancesQueryKey,
	getAccountBalances,
	userResourceKey,
} from "../../state/workspaceResources.ts";
import { useAccountEdit } from "./useAccountEdit.ts";

const CHECKPOINT_AT = "2026-01-01T10:00:00Z";
const checkpointInstant = Date.parse(CHECKPOINT_AT) / 1000;

function account(balance = 100): Account {
	return {
		id: "cash",
		name: "Cash",
		kind: "cash",
		enabled: true,
		archived: false,
		balance,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-01",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
		observedAt: checkpointInstant,
		observedBalance: 100,
		availableBalance: null,
		displayBasis: "available",
		statementClosingDay: 19,
	};
}

function serverWith({
	transactions = [],
}: {
	transactions?: FinancialModel["transactions"];
} = {}) {
	const server = stubTestServer();
	server.model.accounts = [server.model.accounts[0]!];
	server.model.accounts[0]!.name = "Cash";
	server.model.checkpoints = [
		{ AccountId: "cash", Balance: 100, observedAt: checkpointInstant },
	];
	server.model.transactions = transactions;
	server.model.schedules = [];
	return server;
}

function seedLatestRows(balance: number) {
	const row = account(balance) as unknown as AccountBalanceRow;
	serverQueryClient().setQueryData(balancesQueryKey(), {
		accounts: [row],
		asOf: todayIso(),
		revision: "test",
	});
	serverQueryClient().setQueryData(userResourceKey("terms"), {
		paymentTerms: [],
		revision: "test",
	});
}

function submit(edit: ReturnType<typeof useAccountEdit>) {
	return act(async () => {
		await edit.submit({ preventDefault: vi.fn() } as unknown as FormEvent);
	});
}

function patches(server: ReturnType<typeof stubTestServer>) {
	return server.calls.filter(
		(call) => call.method === "PATCH" && call.url === "/v1/accounts/cash",
	);
}

beforeEach(() => {
	setupQueryScope();
});

afterEach(() => {
	teardownQueryScope();
});

describe("authoritative balance editing", () => {
	it("saves the drafted total at the selected time and refreshes existing rows", async () => {
		const server = serverWith();
		seedLatestRows(100);
		const hook = renderHook(() => useAccountEdit(account(), false), {
			wrapper: ServerQueryWrapper,
		});
		act(() => hook.result.current.update({ balance: "125" }, "balance"));
		await waitFor(() => {
			expect(hook.result.current.balanceAtTime).toBe(100);
			expect(hook.result.current.saveBlocked).toBe(false);
		});
		const selected = hook.result.current.observedAt!;
		await submit(hook.result.current);
		await waitFor(() => expect(hook.result.current.saving).toBe(false));
		expect(patches(server)).toHaveLength(1);
		expect(patches(server)[0]!.body).toMatchObject({
			balance: 125,
			observedAt: Math.floor(Date.parse(`${selected}Z`) / 1000),
		});
		expect(getAccountBalances()?.accounts[0]?.balance).toBe(125);
		expect(
			server.calls.every(
				(call) =>
					call.url.startsWith("/v1/accounts/balances") ||
					call.url === "/v1/accounts/cash",
			),
		).toBe(true);
	});

	it("replaces the balance at the same instant instead of layering another delta", async () => {
		const server = serverWith();
		seedLatestRows(100);
		const selected = "2026-02-01T12:00:00";
		const hook = renderHook(
			({ row }: { row: Account }) => useAccountEdit(row, false),
			{
				initialProps: { row: account() },
				wrapper: ServerQueryWrapper,
			},
		);
		act(() => hook.result.current.setObservedAt(selected));
		act(() => hook.result.current.update({ balance: "125" }, "balance"));
		await waitFor(() => {
			expect(hook.result.current.balanceAtTime).toBe(100);
			expect(hook.result.current.saveBlocked).toBe(false);
		});
		await submit(hook.result.current);
		await waitFor(() => expect(hook.result.current.saving).toBe(false));

		hook.rerender({ row: account(125) });
		act(() => hook.result.current.setObservedAt(selected));
		act(() => hook.result.current.update({ balance: "150" }, "balance"));
		await waitFor(() => {
			expect(hook.result.current.balanceAtTime).toBe(125);
			expect(hook.result.current.saveBlocked).toBe(false);
		});
		await submit(hook.result.current);
		await waitFor(() => expect(hook.result.current.saving).toBe(false));

		const writes = patches(server);
		expect(writes).toHaveLength(2);
		expect(writes[0]!.body).toMatchObject({ balance: 125 });
		expect(writes[1]!.body).toMatchObject({ balance: 150 });
		const at = Math.floor(Date.parse(`${selected}Z`) / 1000);
		expect(
			writes.every(
				(write) => (write.body as { observedAt: number }).observedAt === at,
			),
		).toBe(true);
		expect(
			server.model.checkpoints.filter(
				(checkpoint) =>
					checkpoint.AccountId === "cash" && checkpoint.observedAt === at,
			),
		).toEqual([{ AccountId: "cash", Balance: 150, observedAt: at }]);
	});

	it("loads and saves a backdated balance at its own exact cut", async () => {
		const server = serverWith();
		seedLatestRows(100);
		const hook = renderHook(() => useAccountEdit(account(), false), {
			wrapper: ServerQueryWrapper,
		});
		const selected = "2025-12-31T12:00:00";
		act(() => hook.result.current.setObservedAt(selected));
		act(() => hook.result.current.update({ balance: "80" }, "balance"));
		await waitFor(() => {
			expect(hook.result.current.balanceAtTime).toBe(0);
			expect(hook.result.current.saveBlocked).toBe(false);
		});
		await submit(hook.result.current);
		await waitFor(() => expect(hook.result.current.saving).toBe(false));
		expect(patches(server)[0]!.body).toMatchObject({
			balance: 80,
			observedAt: Math.floor(Date.parse(`${selected}Z`) / 1000),
		});
		const historical = await server.fetcher(
			`/v1/accounts/balances?asOf=${encodeURIComponent(`${selected}Z`)}`,
			{ method: "GET" },
		);
		const body = await historical.json();
		expect(body.accounts[0].balance).toBe(80);
		expect(getAccountBalances()?.accounts[0]?.balance).toBe(100);
	});

	it("does not write a checkpoint when the drafted balance matches the selected-time total", async () => {
		const income: FinancialModel["transactions"][number] = {
			id: "income",
			name: "Income",
			sourceAccountId: null,
			destinations: ["cash"],
			amount: { resolver: "expression", config: { expression: "100" } },
			postedTime: Date.parse("2026-01-02T12:00:00Z") / 1000,
			transactionTime: Date.parse("2026-01-02T12:00:00Z") / 1000,
			enabled: true,
			source: "user",
			pending: false,
			void: false,
		} as FinancialModel["transactions"][number];
		const server = serverWith({ transactions: [income] });
		seedLatestRows(200);
		const hook = renderHook(() => useAccountEdit(account(200), false), {
			wrapper: ServerQueryWrapper,
		});
		const selected = "2026-01-01T12:00:00";
		act(() => hook.result.current.setObservedAt(selected));
		act(() => hook.result.current.update({ balance: "100" }, "balance"));
		await waitFor(() => {
			expect(hook.result.current.balanceAtTime).toBe(100);
			expect(hook.result.current.saveBlocked).toBe(false);
		});
		await submit(hook.result.current);
		await waitFor(() => expect(hook.result.current.saving).toBe(false));
		const writes = patches(server);
		expect(writes).toHaveLength(1);
		expect(writes[0]!.body).not.toHaveProperty("balance");
		expect(writes[0]!.body).not.toHaveProperty("observedAt");
		expect(getAccountBalances()?.accounts[0]?.balance).toBe(200);
	});

	it("keeps future observed times accepted by the existing write policy", async () => {
		const server = serverWith();
		seedLatestRows(100);
		const hook = renderHook(() => useAccountEdit(account(), false), {
			wrapper: ServerQueryWrapper,
		});
		const selected = new Date(Date.now() + 365 * 86_400_000)
			.toISOString()
			.slice(0, 19);
		act(() => hook.result.current.setObservedAt(selected));
		act(() => hook.result.current.update({ balance: "150" }, "balance"));
		await waitFor(() => {
			expect(hook.result.current.balanceAtTime).toBe(100);
			expect(hook.result.current.saveBlocked).toBe(false);
		});
		await submit(hook.result.current);
		await waitFor(() => expect(hook.result.current.saving).toBe(false));
		expect(hook.result.current.error).toBeNull();
		expect(patches(server)[0]!.body).toMatchObject({
			balance: 150,
			observedAt: Math.floor(Date.parse(`${selected}Z`) / 1000),
		});
		expect(getAccountBalances()?.accounts[0]?.balance).toBe(100);
	});
});
