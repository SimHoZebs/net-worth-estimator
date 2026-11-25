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

export function billRow(bill: SafeSpendingBill): ObligationRow {
	return {
		id: bill.id,
		name: bill.name,
		date: bill.actualDate || bill.date,
		amount: bill.amount,
		detail: null,
	};
}

export function statementRow(statement: SafeSpendingStatement): ObligationRow {
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
	const payoff = summary.payoffDate;
	const unpaidBills = (summary.bills ?? []).filter(
		(bill) => bill.status !== "paid",
	);
	const beforePayday = payoff
		? unpaidBills.filter((bill) => bill.date < payoff)
		: unpaidBills;
	const onPayday = payoff
		? unpaidBills.filter((bill) => bill.date === payoff)
		: [];
	const status = evidenceStatus(summary);
	const sections: ObligationSection[] = [
		{
			title: "Bills before card payoff",
			total: summary.prePaydayBills,
			rows: beforePayday.map(billRow),
		},
		{
			title: "Bills on card payoff date",
			total: summary.paydayBills,
			rows: onPayday.map(billRow),
		},
		{
			title: "Credit card payoffs",
			total: summary.statementReserve,
			rows: (summary.statements ?? []).map(statementRow),
		},
	];
	const totalsKnown = sections.every((section) => section.total !== null);
	return {
		allowance: {
			cashAsOf: summary.cashAsOf,
			payday: summary.payday,
			status,
			prePaydayRoom: summary.prePaydayRoom,
			postIncomeRoom: summary.postIncomeRoom,
			paymentRoom: summary.paymentRoom,
			expectedPay: summary.expectedPay,
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
