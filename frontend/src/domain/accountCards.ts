import {
	accountTransactions,
	type AccountTransaction,
} from "./accountActivity.ts";
import { dateLabel, money } from "./format.ts";
import type { Account, Plan } from "./model.ts";
import type { Projection } from "./result.ts";

/** Non-exclusive reporting roles; never summed as independent totals. */
export type CardRole = "cash" | "debt" | "investment";
/** Concrete product for icon/account-specific presentation. */
export type CardKind =
	| "checking"
	| "savings"
	| "credit_card"
	| "brokerage"
	| "loan"
	| "other";

export interface CardMetric {
	label: string;
	value: string;
}

export interface AccountCardModel {
	id: string;
	name: string;
	institution: string;
	last4: string;
	kind: CardKind;
	roles: CardRole[];
	/** Positive magnitude: debt shows amount owed, assets show value. */
	balance: number;
	balanceLabel: string;
	summary: string;
	currency: string;
	metrics: CardMetric[];
	transactions: AccountTransaction[];
	creditUtilization?: number;
	/** Never fabricated: omitted unless genuinely known. */
	syncedAt?: undefined;
	connectionStatus?: undefined;
	account: Account;
}

function cardKindFor(account: Account): CardKind {
	const name = account.name.toLowerCase();
	if (account.kind === "cash") {
		if (/(saving|savings|hysa)/.test(name)) return "savings";
		return "checking";
	}
	if (account.kind === "investment") return "brokerage";
	if (account.kind === "property") return "other";
	if (/(credit|card|visa|mastercard|amex)/.test(name)) return "credit_card";
	return "loan";
}

function rolesFor(account: Account): CardRole[] {
	switch (account.kind) {
		case "cash":
			return ["cash"];
		case "investment":
			return ["investment"];
		case "debt":
			return ["debt"];
		case "property":
			return ["investment"];
	}
}

function balanceLabelFor(account: Account, kind: CardKind): string {
	if (account.kind === "debt") {
		return kind === "credit_card"
			? "Current balance owed"
			: "Outstanding balance";
	}
	if (kind === "brokerage") return "Total account value";
	return "Current balance";
}

/**
 * Map real plan accounts into the card visual contract. Balances stay
 * sign-aware in the engine; the card shows positive magnitudes with
 * owed/value semantics. No sample balances, sync times, APRs, or due
 * dates are invented.
 */
export function toAccountCard({
	account,
	plan,
	projection,
}: {
	account: Account;
	plan: Plan;
	projection: Projection | null;
}): AccountCardModel {
	const kind = cardKindFor(account);
	const roles = rolesFor(account);
	const magnitude = Math.abs(account.balance);
	const transactions = projection
		? accountTransactions({ accountId: account.id, plan, projection })
		: [];
	const last = projection?.points.at(-1);
	const ending = last?.balances[account.id] ?? account.balance;
	const withdrawable = Math.max(0, account.balance - account.minBalance);
	const summary =
		account.kind === "debt"
			? `${money(Math.abs(ending))} projected · Protected ${money(account.minBalance)}`
			: `${money(withdrawable)} available · As of ${dateLabel(account.observedOn, true)}`;
	const metrics: CardMetric[] = [
		{ label: "Protected balance", value: money(account.minBalance) },
		{
			label: account.kind === "debt" ? "Amount owed" : "Starting balance",
			value: money(magnitude),
		},
		{ label: "Projected ending", value: money(Math.abs(ending)) },
		{ label: "Observed on", value: dateLabel(account.observedOn, true) },
	];
	if (account.maxBalance !== null) {
		metrics.push({
			label: account.kind === "debt" ? "Credit limit" : "Balance ceiling",
			value: money(account.maxBalance),
		});
	}
	let creditUtilization: number | undefined;
	if (
		account.kind === "debt" &&
		account.maxBalance !== null &&
		account.maxBalance > 0
	) {
		creditUtilization = Math.min(
			100,
			Math.max(0, (magnitude / account.maxBalance) * 100),
		);
	}
	return {
		id: account.id,
		name: account.name,
		institution: account.source,
		last4: "",
		kind,
		roles,
		balance: magnitude,
		balanceLabel: balanceLabelFor(account, kind),
		summary,
		currency: "USD",
		metrics,
		transactions,
		...(creditUtilization !== undefined ? { creditUtilization } : {}),
		account,
	};
}

export function toAccountCards({
	plan,
	projection,
}: {
	plan: Plan;
	projection: Projection | null;
}): AccountCardModel[] {
	return plan.accounts
		.filter((account) => !account.archived)
		.map((account) => toAccountCard({ account, plan, projection }));
}
