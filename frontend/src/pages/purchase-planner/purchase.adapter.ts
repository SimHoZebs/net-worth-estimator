import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { visiblePlannedPurchases } from "../../domain/model.ts";
import type { PurchaseSchedule } from "../../domain/result.ts";
import type {
	PurchaseEnhancements,
	PurchaseOutcome,
	PurchaseViewItem,
} from "./purchase.types.ts";

/**
 * Bridges today's backend contract to the UI without changing persistence.
 * - purchases order is priority.
 * - startDate is EARLIEST eligible date, NOT fixed date.
 * - null schedule means loading/no current result, not a purchase failure.
 * - purchase.date=null means the engine found no date within the horizon.
 * - current API does not explain *why* an item was not scheduled.
 * - future fixed-date mode/outcomes must be supplied explicitly via enhancements.
 */
export function toPurchaseViewItems({
	purchases,
	accounts,
	schedule,
	enhancements = {},
}: {
	purchases: PlannedPurchase[];
	accounts: Account[];
	schedule: PurchaseSchedule | null;
	enhancements?: PurchaseEnhancements;
}): PurchaseViewItem[] {
	const events = new Map(
		schedule?.purchases.map((event) => [event.purchaseId, event]),
	);
	return visiblePlannedPurchases({
		plannedPurchases: purchases,
		accounts,
	}).map((purchase: PlannedPurchase, index): PurchaseViewItem => {
		const enhancement = enhancements[purchase.id];
		const timing = enhancement?.timing ?? {
			kind: "flexible" as const,
			earliestDate: purchase.startDate,
		};
		let outcome: PurchaseOutcome;
		if (!purchase.enabled) {
			outcome = { kind: "excluded" };
		} else if (enhancement?.outcome) {
			outcome = enhancement.outcome;
		} else if (timing.kind === "fixed") {
			// Legacy results have no understanding of fixed dates. Do not represent them as validated.
			outcome = { kind: "pending" };
		} else if (!schedule) {
			outcome = { kind: "pending" };
		} else {
			const event = events.get(purchase.id);
			outcome = event?.date
				? { kind: "scheduled", date: event.date }
				: { kind: "not-scheduled", reason: "unknown" };
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
