import { expect, it } from "vitest";
import type { SafeSpendingBill } from "@/api/generated/model/safeSpendingBill.ts";
import {
	recurringBillIncreases,
	recurringBillMarkers,
} from "./recurringBillIncreases.ts";

it("groups markers from all priced occurrences but projects only unpaid bills", () => {
	const bill: SafeSpendingBill = {
		actualDate: null,
		date: "2026-11-10",
		name: "Phone",
		amount: 20,
		status: "unpaid",
		id: "1",
		transactionId: null,
		scheduleId: "phone",
		accountId: "cash",
	};
	const bills: SafeSpendingBill[] = [
		bill,
		{ ...bill, name: "Rent", status: "paid", amount: 800 },
		{ ...bill, name: "Gas", status: "pending", amount: 25.12 },
		{ ...bill, name: "Water", status: "unknown", amount: null },
	];
	expect(recurringBillIncreases(bills)).toEqual([
		{ date: bill.date, amount: 20, name: "Phone" },
	]);
	expect(recurringBillMarkers(bills)).toEqual([
		{ date: bill.date, amount: 845.12, name: "Phone, Rent, Gas" },
	]);
});
