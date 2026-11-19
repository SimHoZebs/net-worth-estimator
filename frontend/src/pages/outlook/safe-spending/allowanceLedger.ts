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

function billDetail(status: SafeSpendingBill["status"]): string | null {
	if (status === "pending") return "Pending";
	if (status === "unknown") return "Payment unknown";
	return null;
}

function billRow(bill: SafeSpendingBill): ObligationRow {
	return {
		id: bill.id,
		name: bill.name,
		date: bill.date,
		amount: bill.amount,
		detail: billDetail(bill.status),
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
		message:
			status === "uncertain"
				? "Allowance uncertain"
				: status === "missing"
					? "Allowance unavailable"
					: null,
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
	const amount =
		status === "available" && summary.safeToSpend !== null
			? Math.max(0, cents(summary.safeToSpend))
			: null;
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
