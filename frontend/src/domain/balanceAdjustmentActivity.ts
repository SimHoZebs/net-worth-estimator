import type { BalanceAdjustment } from "@/api/generated/model/balanceAdjustment.ts";
import { isoDateFromEpochSeconds } from "./format.ts";
import type { AccountTransaction } from "./accountActivity.ts";

export function balanceAdjustmentActivity(
	adjustments: BalanceAdjustment[],
): AccountTransaction[] {
	return adjustments.map((adjustment) => ({
		id: `balance-adjustment:${adjustment.accountId}:${adjustment.observedAt}`,
		transactionId: "",
		date: isoDateFromEpochSeconds(adjustment.observedAt),
		sortDate: new Date(adjustment.observedAt * 1000).toISOString(),
		name: "Balance adjustment",
		source: "historical",
		direction: adjustment.adjustment < 0 ? "out" : "in",
		flow: "adjustment",
		counterparty: "Balance adjustment",
		from: "",
		to: "",
		amount: Math.abs(adjustment.adjustment),
		requested: 0,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
		adjustment,
	}));
}
