import { createExpressionAmount } from "../simulation/amountResolution";
import type { Posting } from "../types/model";

type PostingOverrides = Partial<Posting> & {
	id: string;
	arithmetic?: string;
};

export function makePosting(overrides: PostingOverrides): Posting {
	const { arithmetic, ...canonicalOverrides } = overrides;
	return {
		label: overrides.id,
		sourceAccountId: null,
		destinations: null,
		amount: createExpressionAmount(arithmetic ?? "0"),
		frequency: "monthly",
		annualRate: 0,
		annualGrowthRate: 0,
		volatility: 0,
		startDate: "2026-01-01",
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
		...canonicalOverrides,
	};
}
