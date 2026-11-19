import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import type { SafeSpendingBill } from "@/api/generated/model/safeSpendingBill.ts";
import type { SafeSpendingStatement } from "@/api/generated/model/safeSpendingStatement.ts";
import type {
	AllowanceEvidence,
	AllowanceLedger,
	EvidenceStatus,
	ObligationRow,
	ObligationSection,
} from "./safeSpendingDetailModel.ts";

const cents = (value: number): number => Math.round(value * 100) / 100;

function evidenceStatus(summary: SafeSpendingSummary): EvidenceStatus {
	if (summary.status === "available") return "available";
	if (summary.status === "uncertain") return "uncertain";
	return "missing";
}

function billRow(bill: SafeSpendingBill): ObligationRow {
	return {
		id: bill.id,
		name: bill.name,
		date: bill.date,
		amount: bill.amount,
		detail: null,
	};
}

function statementRow(statement: SafeSpendingStatement): ObligationRow {
	return {
		id: `${statement.accountId}-${statement.closingDate}-${statement.kind}`,
		name: statement.name,
		date: statement.closingDate,
		amount: statement.amount,
		detail:
			statement.kind === "estimated" ? "Estimated payoff" : "Closed statement",
	};
}

function buildEvidence(summary: SafeSpendingSummary): AllowanceEvidence {
	const status = evidenceStatus(summary);
	return {
		status,
		checkingAvailable: summary.checkingAvailable,
		cashAsOf: summary.cashAsOf,
		baselines: (summary.baselines ?? []).map((baseline) => ({
			accountId: baseline.accountId,
			accountName: baseline.accountName,
			basis: baseline.basis,
			status: baseline.status,
			amount: baseline.availableBalance ?? baseline.postedBalance,
		})),
	};
}

/**
 * Turn the server-owned summary into one dated allowance and the protected
 * obligation ledger that explains it. No amount is recomputed here: the
 * client only groups the server's rows and surfaces its evidence state.
 */
export function buildAllowanceLedger(
	summary: SafeSpendingSummary,
): AllowanceLedger {
	const payday = summary.payday;
	const unpaidBills = (summary.bills ?? []).filter(
		(bill) => bill.status !== "paid",
	);
	const beforePayday = payday
		? unpaidBills.filter((bill) => bill.date < payday)
		: unpaidBills;
	const onPayday = payday
		? unpaidBills.filter((bill) => bill.date >= payday)
		: [];
	const status = evidenceStatus(summary);
	const statementAmountUnknown =
		summary.statementReserve === null ||
		(summary.statements ?? []).some(
			(statement) => statement.amount === null,
		);
	const safe = summary.safeToSpend;
	const beforePayoffs =
		safe === null &&
		statementAmountUnknown &&
		summary.prePaydayRoom !== null
			? Math.max(0, cents(summary.prePaydayRoom))
			: null;
	const amount = safe !== null ? Math.max(0, cents(safe)) : beforePayoffs;
	const amountLabel =
		beforePayoffs !== null
			? "Before card payoffs"
			: "Safe to spend before payday";
	const sections: ObligationSection[] = [
		{
			title: "Bills before payday",
			total: summary.prePaydayBills,
			rows: beforePayday.map(billRow),
		},
		{
			title: "Bills on payday",
			total: summary.paydayBills,
			rows: onPayday.map(billRow),
		},
		{
			title: "Card payoff on payday",
			total: summary.statementReserve,
			rows: (summary.statements ?? []).map(statementRow),
		},
	];
	const totalsKnown = sections.every((section) => section.total !== null);
	return {
		amountLabel,
		allowance: {
			cashAsOf: summary.cashAsOf,
			payday,
			status,
			amount,
			prePaydayRoom: summary.prePaydayRoom,
			postIncomeRoom: summary.postIncomeRoom,
			expectedPay: summary.expectedPay,
			reserve: summary.reserve,
		},
		sections,
		evidence: buildEvidence(summary),
		protectedTotal: totalsKnown
			? cents(
					sections.reduce((total, section) => total + (section.total ?? 0), 0),
				)
			: null,
		obligationCount: sections.reduce(
			(count, section) => count + section.rows.length,
			0,
		),
	};
}
