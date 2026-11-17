import type { AccountTransaction } from "@/domain/accountActivity.ts";
import { inWindow, sumCents } from "@/domain/safeSpendingMath.ts";
import type { SafeSpendingMandatorySection } from "./safeSpendingDetailModel.ts";

/**
 * One definition of recorded cash-payment rows for a cycle. Both the current
 * and closed tab use the same window rule and the same underlying cash
 * activity, so a settlement never moves between cycles by a different test.
 */
export function cashPaymentRows(
	rows: readonly AccountTransaction[],
	start: string,
	end: string,
): AccountTransaction[] {
	return rows.filter(
		(row) =>
			row.flow === "transfer" &&
			row.source === "historical" &&
			inWindow(row.date, start, end),
	);
}

export function cashPaymentSection({
	rows,
	start,
	end,
	title,
	subtitle,
}: {
	rows: readonly AccountTransaction[];
	start: string;
	end: string;
	title: string;
	subtitle: string;
}): SafeSpendingMandatorySection {
	const transactions = cashPaymentRows(rows, start, end);
	return {
		title,
		subtitle,
		// Cash payments are transfers, whose spendingAmount is intentionally
		// zero. Their section total is the recorded amount moved, not spend.
		total: sumCents(transactions, (row) => row.amount),
		transactions,
	};
}
