import type { IndependenceCandidate } from "./financialIndependence.ts";
import { utcDate } from "./format.ts";

export interface IndependenceCoveragePoint {
	time: number;
	coverage: number | null;
	income: number | null;
}

/**
 * One timeline point per candidate date. Incomplete evidence stays null, so
 * TanStack line and area marks break the path instead of drawing through a
 * date the engine could not evaluate.
 */
export function independenceCoveragePoints(
	candidates: ReadonlyArray<
		Pick<
			IndependenceCandidate,
			"date" | "coverage" | "annualIncome" | "annualSpending"
		>
	>,
): IndependenceCoveragePoint[] {
	return candidates.map((row) => {
		const valid =
			row.coverage !== null &&
			row.annualIncome !== null &&
			row.annualSpending !== null &&
			row.annualSpending > 0;
		return {
			time: utcDate(row.date).getTime(),
			coverage: valid ? Math.max(0, row.coverage!) : null,
			income: valid
				? Math.max(0, row.annualIncome! / row.annualSpending!)
				: null,
		};
	});
}
