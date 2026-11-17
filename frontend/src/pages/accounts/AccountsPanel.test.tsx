import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account } from "../../domain/model.ts";
import { AccountsPanel } from "./AccountsPanel.tsx";

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: "cash",
		name: "Cash",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 798.01,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Synced balance check",
		readOnly: false,
		observedAt: 1773133200,
		observedBalance: 798.01,
		availableBalance: 1244.43,
		displayBasis: "available",
		...overrides,
	};
}

const render = (accounts: Account[]) =>
	renderToStaticMarkup(
		<AccountsPanel accounts={accounts} showHeaders onAccount={() => {}} />,
	);

describe("accounts panel current balance", () => {
	it("shows bank-reported available cash instead of the modeled balance", () => {
		const html = render([account()]);
		expect(html).toContain("Current balance");
		expect(html).toContain("$1,244");
		expect(html).not.toContain("$798");
	});
	it("shows a reported zero as a current balance", () => {
		const html = render([account({ availableBalance: 0 })]);
		expect(html).toContain("$0");
		expect(html).not.toContain("Unavailable");
	});
	it("shows unavailable when a synced account reports no available figure", () => {
		const html = render([account({ availableBalance: null, readOnly: true })]);
		expect(html).toContain("Unavailable");
		expect(html).not.toContain("$798");
	});
	it("shows the saved balance for manual accounts without bank evidence", () => {
		const html = render([account({ availableBalance: null, readOnly: false })]);
		expect(html).toContain("$798");
		expect(html).not.toContain("Unavailable");
	});
	it("shows the posted total when the account basis is posted", () => {
		const html = render([
			account({ displayBasis: "posted", observedBalance: 798.01 }),
		]);
		expect(html).toContain("$798");
		expect(html).not.toContain("$1,244");
		expect(html).not.toContain("Unavailable");
	});
	it("falls back to the saved balance for posted basis without observation", () => {
		const html = render([
			account({
				displayBasis: "posted",
				observedBalance: null,
				availableBalance: null,
				readOnly: false,
			}),
		]);
		expect(html).toContain("$798");
		expect(html).not.toContain("Unavailable");
	});
});
