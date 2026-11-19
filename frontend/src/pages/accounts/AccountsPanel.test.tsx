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

const figures = (html: string) =>
	[
		...html.matchAll(
			/<dt[^>]*>([^<]*)<\/dt><dd class="([^"]*)">([\s\S]*?)<\/dd>/g,
		),
	].map((match) => ({
		label: match[1] ?? "",
		className: match[2] ?? "",
		text: match[3] ?? "",
	}));

const figure = (html: string, label: string) => {
	const found = figures(html).find((entry) => entry.label === label);
	if (!found) throw new Error(`Missing figure: ${label}`);
	return found;
};

describe("accounts panel current balance", () => {
	it("shows only the selected available figure under the current balance header", () => {
		const html = render([account()]);
		expect(html).toContain("Current balance");
		expect(html).toContain("Accounts and current balances.");
		expect(html).not.toContain("Balances");
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Available balance").text).toContain("$1,244");
		expect(html).not.toContain("$798");
		expect(figure(html, "Available balance").className).toContain(
			"text-sm font-normal tabular-nums text-foreground",
		);
		expect(figure(html, "Available balance").className).not.toContain(
			"text-lg",
		);
	});
	it("shows a reported zero as $0 rather than unavailable", () => {
		const html = render([account({ availableBalance: 0 })]);
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Available balance").text).toContain("$0");
		expect(html).not.toContain("Unavailable");
	});
	it("omits the available figure and falls back to posted when a synced account reports none", () => {
		const html = render([account({ availableBalance: null, readOnly: true })]);
		expect(html).not.toContain("Available balance");
		expect(html).not.toContain("Unavailable");
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Posted balance").text).toContain("$798");
		expect(figure(html, "Posted balance").className).toContain(
			"text-sm font-normal tabular-nums text-foreground",
		);
		expect(figure(html, "Posted balance").className).not.toContain("text-lg");
	});
	it("keeps the saved balance as the posted figure for manual accounts without bank evidence", () => {
		const html = render([account({ availableBalance: null, readOnly: false })]);
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Posted balance").text).toContain("$798");
		expect(html).not.toContain("Available balance");
		expect(html).not.toContain("Unavailable");
	});
	it("selects the posted figure when the account basis is posted", () => {
		const html = render([
			account({ displayBasis: "posted", observedBalance: 798.01 }),
		]);
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Posted balance").text).toContain("$798");
		expect(html).not.toContain("$1,244");
		expect(html).not.toContain("Available balance");
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
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Posted balance").text).toContain("$798");
		expect(html).not.toContain("Available balance");
		expect(html).not.toContain("Unavailable");
	});
	it("does not render a sync date even for an observed account", () => {
		const html = render([account()]);
		expect(html).not.toContain("Last synced");
		expect(html).not.toContain("Jan 31, 2026");
		expect(html).not.toContain('dateTime="2026-01-31"');
		expect(figures(html)).toHaveLength(1);
		expect(figure(html, "Available balance").text).toContain("$1,244");
	});
});
