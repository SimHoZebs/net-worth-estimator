import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { visiblePlannedPurchases } from "../../domain/model.ts";
import type { PurchaseSchedule } from "../../domain/result.ts";
import type { PurchaseOutcome, PurchaseViewItem } from "./purchase.types.ts";

/**
 * Bridges today's backend contract to the UI without changing persistence.
 * - purchases order is priority.
 * - startDate is the earliest eligible date, never a fixed date.
 * - null schedule means loading/no current result, not a purchase failure.
 * - purchase.date=null means the engine found no date within the horizon.
 */
export function toPurchaseViewItems({
	purchases,
	accounts,
	schedule,
}: {
	purchases: PlannedPurchase[];
	accounts: Account[];
	schedule: PurchaseSchedule | null;
}): PurchaseViewItem[] {
	const events = new Map(
		schedule?.purchases.map((event) => [event.purchaseId, event]),
	);
	return visiblePlannedPurchases({
		plannedPurchases: purchases,
		accounts,
	}).map((purchase: PlannedPurchase, index): PurchaseViewItem => {
		const timing = {
			earliestDate: purchase.startDate,
		};
		let outcome: PurchaseOutcome;
		if (!purchase.enabled) {
			outcome = { kind: "excluded" };
		} else if (!schedule) {
			outcome = { kind: "pending" };
		} else {
			const event = events.get(purchase.id);
			outcome = event?.date
				? { kind: "scheduled", date: event.date }
				: { kind: "not-scheduled" };
		}
		return {
			purchase,
			priority: index + 1,
			accountName:
				accounts.find((account) => account.id === purchase.fromId)?.name ??
				"Funding account unavailable",
			timing,
			outcome,
		};
	});
}
