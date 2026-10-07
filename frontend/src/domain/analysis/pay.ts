import { isHistoricalMovement, type Movement, type Plan } from "../model.ts";
import { quantile } from "../result.ts";
import type { EvidenceItem, EvidenceStrength } from "./evidence.ts";
import { toAnalysisResult } from "./runtime.ts";
import type { AnalysisDiagnostic, AnalysisResult } from "./types.ts";

export interface PayAnalysis {
	typical: number;
	monthly: boolean;
	annualized: number | null;
	strong: boolean;
	candidates: Movement[];
	comparable: Movement[];
	excluded: Movement[];
	evidence: EvidenceItem[];
	strength: EvidenceStrength;
}

function comparableRecords(plan: Plan) {
	const candidates = plan.movements.filter(
		(m) => isHistoricalMovement(m, plan.startDate) && !m.fromId && m.toId,
	);
	const selected = candidates.filter(
		(m) => m.enabled && m.amountKnown && m.startDate <= plan.startDate,
	);
	const typical = quantile({
		values: selected.map((m) => m.amount),
		fraction: 0.5,
	});
	const comparable = selected.filter(
		(m) => typical > 0 && Math.abs(m.amount - typical) / typical < 0.2,
	);
	return { candidates, comparable, typical };
}

export function analyzePay(plan: Plan): AnalysisResult<PayAnalysis> {
	const diagnostics: AnalysisDiagnostic[] = [];
	const { candidates, comparable, typical } = comparableRecords(plan);
	if (!candidates.length) {
		return toAnalysisResult<PayAnalysis>({
			value: null as unknown as PayAnalysis,
			diagnostics: [
				{
					code: "pay.no-records",
					severity: "error",
					message: "No recorded one-time external inflows are available.",
				},
			],
		});
	}
	const excluded = candidates.filter((m) => !comparable.includes(m));
	const ordered = [...comparable].sort((a, b) =>
		a.startDate.localeCompare(b.startDate),
	);
	const gaps = ordered
		.slice(1)
		.map(
			(m, i) =>
				(Date.parse(m.startDate) -
					Date.parse(ordered[i]?.startDate ?? m.startDate)) /
				86400000,
		);
	const monthly =
		gaps.length >= 2 && gaps.every((gap) => gap >= 27 && gap <= 32);
	const strong = comparable.length >= 6 && monthly;
	const strength: EvidenceStrength = strong
		? "strong"
		: comparable.length >= 3
			? "moderate"
			: "weak";
	const evidence: EvidenceItem[] = [
		{
			code: "pay.cadence",
			source: "behavioral",
			strength: monthly ? "strong" : "weak",
			message: monthly
				? `${comparable.length} comparable records arrive on a monthly cadence.`
				: "Record spacing does not establish a monthly cadence.",
			transactionIds: comparable.map((m) => m.id),
		},
		{
			code: "pay.comparability",
			source: "source",
			strength: comparable.length >= 6 ? "strong" : "moderate",
			message: `${comparable.length} of ${candidates.length} records sit within 20% of the typical inflow.`,
			transactionIds: comparable.map((m) => m.id),
		},
	];
	if (excluded.length) {
		evidence.push({
			code: "pay.exclusions",
			source: "source",
			strength: "moderate",
			message: `${excluded.length} records were excluded as dissimilar or disabled.`,
			transactionIds: excluded.map((m) => m.id),
		});
	}
	if (comparable.length < 6) {
		diagnostics.push({
			code: "pay.few-records",
			severity: "warning",
			message: "Fewer than six comparable records limit confidence.",
		});
	}
	if (!monthly) {
		diagnostics.push({
			code: "pay.cadence-unclear",
			severity: "warning",
			message:
				"Cadence is not established, so no annualized figure is reported.",
		});
	}
	return toAnalysisResult({
		value: {
			typical,
			monthly,
			annualized: monthly ? typical * 12 : null,
			strong,
			candidates,
			comparable,
			excluded,
			evidence,
			strength,
		},
		diagnostics,
	});
}
