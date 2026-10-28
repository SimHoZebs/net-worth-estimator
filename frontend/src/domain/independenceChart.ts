import { lineChartModel } from "./chart.ts";
import { utcDate } from "./format.ts";
import type {
	FinancialIndependenceAnalysis,
	IndependenceCandidate,
} from "./financialIndependence.ts";

/** Candidate-date coverage, not a forecast of balances after independence. */
export function independenceChartModel(
	analysis: FinancialIndependenceAnalysis,
	narrow = false,
) {
	const start = utcDate(analysis.startDate).getTime();
	const last = analysis.candidates.at(-1);
	const end = utcDate(
		analysis.endDate ?? last?.date ?? analysis.startDate,
	).getTime();
	const geometry = lineChartModel({
		xMax: Math.max(1, end - start),
		low: 0,
		high: Math.max(
			1.25,
			...analysis.candidates.map((row) => (row.coverage ?? 0) * 1.1),
		),
		width: narrow ? 280 : 560,
		height: narrow ? 210 : 230,
		left: narrow ? 24 : 40,
		right: narrow ? 8 : 12,
		top: 22,
		bottom: 30,
	});
	const x = (date: string) => geometry.x(utcDate(date).getTime() - start);
	const valid = (row: IndependenceCandidate) =>
		row.coverage !== null &&
		row.annualIncome !== null &&
		row.annualSpending !== null &&
		row.annualSpending > 0;
	const groups: IndependenceCandidate[][] = [];
	for (const candidate of analysis.candidates) {
		if (!valid(candidate)) {
			groups.push([]);
			continue;
		}
		if (!groups.length) groups.push([]);
		groups[groups.length - 1]!.push(candidate);
	}
	const income = (row: IndependenceCandidate) =>
		Math.max(0, row.annualIncome! / row.annualSpending!);
	const coverage = (row: IndependenceCandidate) => Math.max(0, row.coverage!);
	const path = (
		rows: IndependenceCandidate[],
		value: (row: IndependenceCandidate) => number,
	) =>
		rows
			.map(
				(row, index) =>
					`${index ? "L" : "M"}${x(row.date)},${geometry.y(value(row))}`,
			)
			.join(" ");
	const area = (
		top: (row: IndependenceCandidate) => number,
		bottom: (row: IndependenceCandidate) => number,
	) =>
		groups
			.filter((rows) => rows.length)
			.map(
				(rows) =>
					`${path(rows, top)} ${path([...rows].reverse(), bottom).replace("M", "L")} Z`,
			)
			.join(" ");
	return {
		...geometry,
		x,
		incomePath: area(income, () => 0),
		withdrawalPath: area(coverage, income),
		capacityPath: groups.map((rows) => path(rows, coverage)).join(" "),
		lastX: last ? x(last.date) : geometry.left,
		endDate: analysis.endDate ?? last?.date ?? analysis.startDate,
	};
}
