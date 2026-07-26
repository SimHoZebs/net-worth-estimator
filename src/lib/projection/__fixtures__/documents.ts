import type { FinancialModelDocument } from "../types/model";
import { makeAccount } from "./accounts";
import { makePosting } from "./postings";

export function createBaseDocument(
	overrides: Partial<FinancialModelDocument> = {},
): FinancialModelDocument {
	return {
		sourcePath: "/configs",
		accounts: [
			makeAccount({ id: "checking" }),
			makeAccount({ id: "brokerage" }),
			makeAccount({ id: "loan" }),
		],
		checkpoints: [
			{ Date: "2026-01-31", AccountId: "checking", Balance: 800 },
			{ Date: "2026-01-31", AccountId: "brokerage", Balance: 1200 },
			{ Date: "2026-01-31", AccountId: "loan", Balance: -400 },
		],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			postingFulfillment: [],
		},
		postings: [
			makePosting({
				id: "salary",
				destinations: ["checking"],
				arithmetic: "1000",
				startDate: "2026-02-05",
				endDate: "2026-02-05",
			}),
			makePosting({
				id: "spend",
				sourceAccountId: "checking",
				arithmetic: "200",
				startDate: "2026-02-06",
				endDate: "2026-02-06",
			}),
			makePosting({
				id: "invest",
				sourceAccountId: "checking",
				destinations: ["brokerage"],
				arithmetic: "900",
				startDate: "2026-02-10",
				endDate: "2026-02-10",
			}),
			makePosting({
				id: "paydown",
				sourceAccountId: "checking",
				destinations: ["loan"],
				arithmetic: "salary * 0.25",
				startDate: "2026-02-20",
				endDate: "2026-02-20",
				priority: 2,
			}),
		],
		...overrides,
	};
}
