import type { SafeSpendingBill } from "@/api/generated/model/safeSpendingBill.ts";
import { groupByDate } from "./safeSpendingMath.ts";

export interface RecurringBillIncrease {
	date: string;
	amount: number;
	name?: string;
}

export function recurringBillMarkers(bills: readonly SafeSpendingBill[]) {
	return groupByDate(
		bills,
		(row) => row.amount,
		(row) => row.name,
	);
}

export function recurringBillIncreases(bills: readonly SafeSpendingBill[]) {
	return recurringBillMarkers(bills.filter((row) => row.status === "unpaid"));
}
