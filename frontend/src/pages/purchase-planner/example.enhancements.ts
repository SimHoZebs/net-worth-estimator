import type { PurchaseEnhancements } from "./purchase.types.ts";

/** MOCK DATA ONLY — do not pass to production as real funding evidence.
 * Replace the IDs below with actual purchase IDs for a prototype.
 * The existing Net Worth Estimator backend does NOT return fixed-date outcomes yet.
 */
export const exampleFixedDateEnhancements: PurchaseEnhancements = {
	"mock-purchase-5": {
		timing: { kind: "fixed", requiredDate: "2027-03-01" },
		outcome: {
			kind: "fixed-conflict",
			date: "2027-03-01",
			shortfall: 320,
			available: 680,
			explanation:
				"Example only: reserved funds cannot cover the full cost on the specified date.",
		},
	},
};
