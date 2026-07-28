import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransactionCompletionTable } from "./TransactionCompletionTable";

describe("TransactionCompletionTable", () => {
	it("renders zero-request transactions as complete without a warning date", () => {
		const html = renderToStaticMarkup(
			<TransactionCompletionTable
				postingSummaries={[
					{
						postingId: "zero",
						label: "Zero request",
						sourceAccountId: "cash",
						sourceAccountLabel: "Cash",
						destinations: null,
						priority: 1,
						annualCap: null,
						requestedAmount: 0,
						realizedAmount: 0,
						destinationLimitedAmount: 0,
						utilizationRate: 0,
						completionRate: 1,
						firstUnderfulfilledDate: null,
						unfulfilledAmount: 0,
					},
				]}
			/>,
		);

		expect(html).toContain("100%");
		expect(html).not.toContain("text-tertiary-foreground");
	});
});
