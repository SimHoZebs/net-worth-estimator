import { describe, expect, it } from "vitest";
import type { Account } from "./model.ts";
import {
	accountBalanceDisplayData,
	accountBalanceHeaderData,
	accountBalanceSelectedData,
	canChooseDisplayBasis,
	componentIds,
	displayBalance,
	effectiveDisplayBasis,
	isGroupedDisplay,
	toDisplayAccounts,
	toDisplayTransaction,
} from "./accountDisplay.ts";
import { accountTrendRows } from "./chart.ts";
import { projectionFixture, transactionFixture } from "../mocks/projection.ts";
import { accountTransactions } from "./accountActivity.ts";

function account(
	id: string,
	balance: number,
	availableBalance: number | null = null,
): Account {
	return {
		id,
		name: id,
		kind: "debt",
		enabled: true,
		archived: false,
		balance,
		minBalance: 0,
		maxBalance: 0,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
		observedAt: 100,
		observedBalance: balance,
		availableBalance,
		displayBasis: "available",
	};
}
function fixture() {
	const principal = account("p", -1000);
	principal.display = {
		name: "Student loan",
		components: [
			{ accountId: "p", role: "principal" },
			{ accountId: "i", role: "interest" },
		],
		interestScheduleId: "charge",
		paymentScheduleId: "pay",
	};
	return [principal, account("i", -20), account("unrelated-interest", -30)];
}

function passthrough(id: string, balance: number): Account {
	const row = account(id, balance);
	row.kind = "cash";
	row.display = {
		name: id,
		components: [{ accountId: id, role: "primary" }],
		interestScheduleId: "",
		paymentScheduleId: "",
	};
	return row;
}

describe("visible accounts", () => {
	it("treats only multi-component displays as grouped", () => {
		expect(isGroupedDisplay(null)).toBe(false);
		expect(isGroupedDisplay(undefined)).toBe(false);
		expect(isGroupedDisplay(account("cash", 100))).toBe(false);
		expect(isGroupedDisplay(passthrough("cash", 100))).toBe(false);
		expect(isGroupedDisplay(fixture()[0])).toBe(true);
	});
	it("leaves stored 1:1 passthrough rows untouched", () => {
		const ordinary = passthrough("cash", 100);
		ordinary.availableBalance = 0;
		const grouped = toDisplayAccounts([ordinary, ...fixture()]);
		expect(grouped).toHaveLength(3);
		expect(grouped[0]).toBe(ordinary);
		expect(grouped[0]).toMatchObject({ maxBalance: 0, availableBalance: 0 });
		expect(componentIds(grouped[0]!)).toEqual(["cash"]);
		expect(isGroupedDisplay(grouped[0])).toBe(false);
	});
	it("groups explicit roles once and preserves ordinary accounts", () => {
		const raw = fixture();
		const grouped = toDisplayAccounts(raw);
		expect(grouped).toHaveLength(2);
		expect(grouped[0]).toMatchObject({
			name: "Student loan",
			balance: -1020,
			observedBalance: -1020,
		});
		expect(grouped[1]).toBe(raw[2]);
		expect(raw[0]!.balance).toBe(-1000);
		expect(componentIds(grouped[0]!)).toEqual(["p", "i"]);
	});
	it("aggregates sync ownership across grouped components", () => {
		const raw = fixture();
		raw[1]!.syncOwned = true;
		raw[1]!.readOnly = true;
		expect(toDisplayAccounts(raw)[0]).toMatchObject({
			readOnly: true,
			syncOwned: true,
		});
	});
	it("keeps different observation times separate", () => {
		const raw = fixture();
		raw[1]!.observedAt = 200;
		expect(toDisplayAccounts(raw)[0]).toMatchObject({
			observedBalance: null,
			observedAt: null,
			balanceCheck: false,
			balance: -1020,
		});
	});
	it("sums grouped current available evidence only when every component reports it", () => {
		const raw = fixture();
		raw[0]!.availableBalance = 1000;
		raw[1]!.availableBalance = 44.43;
		expect(toDisplayAccounts(raw)[0]).toMatchObject({
			balance: -1020,
			availableBalance: 1044.43,
		});
		raw[1]!.availableBalance = null;
		expect(toDisplayAccounts(raw)[0]?.availableBalance).toBeNull();
	});
	it("keeps a reported zero in the grouped current available total", () => {
		const raw = fixture();
		raw[0]!.availableBalance = 0;
		raw[1]!.availableBalance = 0;
		expect(toDisplayAccounts(raw)[0]?.availableBalance).toBe(0);
	});
	it("does not derive current available evidence from modeled balances", () => {
		expect(toDisplayAccounts(fixture())[0]?.availableBalance).toBeNull();
	});
	describe("effectiveDisplayBasis", () => {
		it("defaults to available when the account reports an available figure", () => {
			expect(effectiveDisplayBasis(account("cash", 100, 44.43))).toBe(
				"available",
			);
		});
		it("keeps a persisted posted basis when both figures exist", () => {
			const row = account("cash", 100, 44.43);
			row.displayBasis = "posted";
			expect(effectiveDisplayBasis(row)).toBe("posted");
		});
		it("treats a reported zero as an available figure", () => {
			expect(effectiveDisplayBasis(account("cash", 100, 0))).toBe("available");
		});
		it("falls back to posted when available is missing without rewriting the draft", () => {
			const row = account("cash", 100, null);
			expect(effectiveDisplayBasis(row)).toBe("posted");
			expect(row.displayBasis).toBe("available");
			row.displayBasis = "posted";
			expect(effectiveDisplayBasis(row)).toBe("posted");
		});
	});
	describe("canChooseDisplayBasis", () => {
		it("allows the choice when both figures exist", () => {
			expect(canChooseDisplayBasis(account("cash", 100, 44.43))).toBe(true);
		});
		it("allows the choice with a reported zero available figure", () => {
			expect(canChooseDisplayBasis(account("cash", 100, 0))).toBe(true);
		});
		it("uses the saved balance as posted when observation is missing", () => {
			const row = account("cash", 100, 44.43);
			row.observedBalance = null;
			expect(canChooseDisplayBasis(row)).toBe(true);
		});
		it("disallows the choice when the available figure is missing", () => {
			expect(canChooseDisplayBasis(account("cash", 100, null))).toBe(false);
			const synced = account("cash", 100, null);
			synced.readOnly = true;
			expect(canChooseDisplayBasis(synced)).toBe(false);
		});
	});
	describe("accountBalanceDisplayData", () => {
		it("prepares both labeled entries with emphasis on the effective available figure", () => {
			const row = account("cash", 100, 44.43);
			row.syncOwned = true;
			row.readOnly = true;
			expect(accountBalanceDisplayData(row)).toEqual({
				entries: [
					{ label: "Posted balance", value: 100, emphasized: false },
					{ label: "Available balance", value: 44.43, emphasized: true },
				],
				synced: "2026-01-31",
			});
		});
		it("uses the saved balance as the posted entry when no observation exists", () => {
			const row = account("cash", 100, 44.43);
			row.observedBalance = null;
			expect(accountBalanceDisplayData(row).entries[0]).toEqual({
				label: "Posted balance",
				value: 100,
				emphasized: false,
			});
		});
		it("only prepares the posted entry, emphasized, when available is missing", () => {
			const data = accountBalanceDisplayData(account("cash", 100, null));
			expect(data.entries).toEqual([
				{ label: "Posted balance", value: 100, emphasized: true },
			]);
		});
		it("keeps a reported zero available entry with emphasis", () => {
			const data = accountBalanceDisplayData(account("cash", 100, 0));
			expect(data.entries[1]).toEqual({
				label: "Available balance",
				value: 0,
				emphasized: true,
			});
		});
		it("moves emphasis to the posted entry when the persisted choice is posted", () => {
			const row = account("cash", 100, 44.43);
			row.displayBasis = "posted";
			expect(accountBalanceDisplayData(row).entries).toEqual([
				{ label: "Posted balance", value: 100, emphasized: true },
				{ label: "Available balance", value: 44.43, emphasized: false },
			]);
		});
		it("emphasizes the posted entry when available is missing without rewriting the draft", () => {
			const row = account("cash", 100, null);
			row.displayBasis = "available";
			const data = accountBalanceDisplayData(row);
			expect(data.entries[0]?.emphasized).toBe(true);
			expect(row.displayBasis).toBe("available");
		});
		it("reports a bank-owned account's recorded date even when read-only", () => {
			const synced = account("cash", 100);
			synced.syncOwned = true;
			synced.readOnly = true;
			expect(accountBalanceDisplayData(synced).synced).toBe("2026-01-31");
			const unobserved = account("cash", 100);
			unobserved.syncOwned = true;
			unobserved.readOnly = true;
			unobserved.observedOn = "";
			expect(accountBalanceDisplayData(unobserved).synced).toBeNull();
		});
		it("does not report a sync date for a manual account with no ownership signal, even when read-only", () => {
			const manual = account("cash", 100);
			manual.source = "Manual entry";
			manual.readOnly = true;
			expect(accountBalanceDisplayData(manual).synced).toBeNull();
		});
		it("does not report a sync date for a manual account with an observation date", () => {
			const manual = account("cash", 100);
			manual.readOnly = false;
			expect(manual.observedOn).toBe("2026-01-31");
			expect(accountBalanceDisplayData(manual).synced).toBeNull();
		});
	});
	describe("accountBalanceHeaderData", () => {
		it("shows available first then posted with emphasis on the effective available figure", () => {
			const row = account("cash", 100, 44.43);
			row.syncOwned = true;
			row.readOnly = true;
			expect(accountBalanceHeaderData(row)).toEqual({
				entries: [
					{ label: "Available balance", value: 44.43, emphasized: true },
					{ label: "Posted balance", value: 100, emphasized: false },
				],
				synced: "2026-01-31",
			});
		});
		it("keeps available first while emphasizing posted when the persisted choice is posted", () => {
			const row = account("cash", 100, 44.43);
			row.displayBasis = "posted";
			expect(accountBalanceHeaderData(row).entries).toEqual([
				{ label: "Available balance", value: 44.43, emphasized: false },
				{ label: "Posted balance", value: 100, emphasized: true },
			]);
		});
		it("shows only the posted entry when available is missing", () => {
			const row = account("cash", 100, null);
			row.syncOwned = true;
			row.readOnly = true;
			expect(accountBalanceHeaderData(row)).toEqual({
				entries: [{ label: "Posted balance", value: 100, emphasized: true }],
				synced: "2026-01-31",
			});
		});
		it("keeps a reported zero available entry first", () => {
			expect(accountBalanceHeaderData(account("cash", 100, 0)).entries).toEqual(
				[
					{ label: "Available balance", value: 0, emphasized: true },
					{ label: "Posted balance", value: 100, emphasized: false },
				],
			);
		});
		it("passes through a bank-owned account's recorded date even when read-only", () => {
			const synced = account("cash", 100, 44.43);
			synced.syncOwned = true;
			synced.readOnly = true;
			expect(accountBalanceHeaderData(synced).synced).toBe("2026-01-31");
			const unobserved = account("cash", 100, 44.43);
			unobserved.syncOwned = true;
			unobserved.readOnly = true;
			unobserved.observedOn = "";
			expect(accountBalanceHeaderData(unobserved).synced).toBeNull();
		});
		it("does not pass through a sync date for a manual account with no ownership signal, even when read-only", () => {
			const manual = account("cash", 100, 44.43);
			manual.source = "Manual entry";
			manual.readOnly = true;
			expect(accountBalanceHeaderData(manual).synced).toBeNull();
		});
		it("does not pass through a sync date for a manual account with an observation date", () => {
			const manual = account("cash", 100, 44.43);
			manual.readOnly = false;
			expect(manual.observedOn).toBe("2026-01-31");
			expect(accountBalanceHeaderData(manual).synced).toBeNull();
		});
	});
	describe("accountBalanceSelectedData", () => {
		it("selects only the available entry when the effective basis is available", () => {
			expect(accountBalanceSelectedData(account("cash", 100, 44.43))).toEqual({
				entries: [
					{ label: "Available balance", value: 44.43, emphasized: true },
				],
				synced: null,
			});
		});
		it("selects only the posted entry when the persisted basis is posted", () => {
			const row = account("cash", 100, 44.43);
			row.displayBasis = "posted";
			expect(accountBalanceSelectedData(row)).toEqual({
				entries: [{ label: "Posted balance", value: 100, emphasized: true }],
				synced: null,
			});
		});
		it("selects the emphasized posted entry when available is missing", () => {
			const data = accountBalanceSelectedData(account("cash", 100, null));
			expect(data.entries).toEqual([
				{ label: "Posted balance", value: 100, emphasized: true },
			]);
		});
		it("keeps a reported zero as the selected available entry", () => {
			expect(
				accountBalanceSelectedData(account("cash", 100, 0)).entries,
			).toEqual([{ label: "Available balance", value: 0, emphasized: true }]);
		});
		it("never carries a sync date, even for an observed account", () => {
			expect(
				accountBalanceSelectedData(account("cash", 100)).synced,
			).toBeNull();
			const unobserved = account("cash", 100, 44.43);
			unobserved.observedOn = "";
			expect(accountBalanceSelectedData(unobserved).synced).toBeNull();
		});
		it("selects the group available figure, then the group posted figure on a posted basis", () => {
			const raw = fixture();
			raw[0]!.availableBalance = 1000;
			raw[1]!.availableBalance = 44.43;
			const grouped = toDisplayAccounts(raw)[0]!;
			expect(accountBalanceSelectedData(grouped)).toEqual({
				entries: [
					{ label: "Available balance", value: 1044.43, emphasized: true },
				],
				synced: null,
			});
			grouped.displayBasis = "posted";
			expect(accountBalanceSelectedData(grouped).entries).toEqual([
				{ label: "Posted balance", value: -1020, emphasized: true },
			]);
		});
	});
	it("includes interest-only balances in projection lines", () => {
		const accounts = toDisplayAccounts(fixture());
		const balances = { p: 0, i: -15 };
		expect(displayBalance(accounts[0]!, balances)).toBe(-15);
		const projection = projectionFixture();
		const points = [{ ...projection.points[0]!, balances }];
		const result = accountTrendRows({ points, accounts });
		expect(result.series).toHaveLength(1);
		expect(result.rows[0]?.balance).toBe(-15);
	});
	it("shows one payment with both component deltas in account activity", () => {
		const accounts = toDisplayAccounts(fixture());
		const projection = projectionFixture();
		projection.transactions = [
			{
				...transactionFixture(),
				transactionId: "pay",
				date: "2026-02-02",
				fromId: "checking",
				toId: "i",
				requested: 100,
				realized: 100,
				accountDeltas: [
					{ accountId: "checking", delta: -100 },
					{ accountId: "i", delta: 20 },
					{ accountId: "p", delta: 80 },
				],
			},
		];
		const rows = accountTransactions({
			accountId: "p",
			accounts,
			transactions: [],
			projection,
			startDate: "2026-01-31",
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			amount: 100,
			direction: "in",
			to: "Student loan",
		});
	});
	it("maps an interest endpoint to the visible loan", () => {
		const accounts = toDisplayAccounts(fixture());
		const row = toDisplayTransaction(
			{
				id: "pay",
				fromId: "checking",
				toId: "i",
				readOnly: false,
				recognizedBusinessKey: "spotify",
			} as Parameters<typeof toDisplayTransaction>[0],
			accounts,
		);
		expect(row.toId).toBe("p");
		expect(row.readOnly).toBe(true);
		expect(row.recognizedBusinessKey).toBe("spotify");
	});
});
