import type {
	AnalysisDiagnostic,
	ClassifiedPostingAnalysisDefinition,
	EvidenceItem,
	EvidenceStrength,
	EvidenceSummary,
} from "@/lib/analysis";
import {
	payerClassifier,
	paymentRailClassifier,
	payrollClassifier,
} from "@/lib/analysis";

const payrollDetectionClassificationRequirements = [
	payerClassifier,
	payrollClassifier,
	paymentRailClassifier,
] as const;

export interface PayrollCandidateTransaction {
	id: string;
	bookedDate: string;
	amount: number;
}

export interface PayrollCandidate {
	key: string;
	accountId: string;
	currency: "USD";
	payerLabel: string;
	transactions: PayrollCandidateTransaction[];
	identityEvidence: EvidenceSummary;
	regularityEvidence: EvidenceSummary;
	recurring: boolean;
}

export interface PayrollDetectionResult {
	candidates: PayrollCandidate[];
}

function dayDifference(left: string, right: string): number {
	return (
		(Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) /
		86_400_000
	);
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function strengthRank(strength: EvidenceStrength): number {
	return strength === "strong" ? 3 : strength === "moderate" ? 2 : 1;
}

function summary(
	items: EvidenceItem[],
	strength: EvidenceStrength,
): EvidenceSummary {
	return { strength, items };
}

export const payrollDetectionAnalysis: ClassifiedPostingAnalysisDefinition<PayrollDetectionResult> =
	{
		id: "payroll-detection",
		label: "Payroll detection",
		classificationRequirements: payrollDetectionClassificationRequirements,
		run({ input }) {
			const grouped = new Map<
				string,
				{
					accountId: string;
					payerLabel: string;
					transactions: PayrollCandidateTransaction[];
					evidence: EvidenceItem[];
				}
			>();

			for (const classified of input.postings) {
				const { posting: transaction, classifications } = classified;
				if (transaction.amount === null || transaction.amount <= 0) continue;
				if (classifications.get(payrollClassifier) === null) continue;
				const payer = classifications.get(payerClassifier)?.value;
				if (!payer) continue;
				const classificationEvidence = classifications.evidenceFor(
					payrollDetectionClassificationRequirements,
				);
				const explicit = classificationEvidence.some(
					(item) => item.code === "source.transaction-type",
				);
				const hasLanguage = classificationEvidence.some(
					(item) => item.code === "payroll.language",
				);
				const identity = payer.identity;
				if (!explicit && (!hasLanguage || identity === null)) continue;
				const payerKey = identity ?? `unidentified:${transaction.id}`;
				const key = `${transaction.accountId}:USD:${payerKey}`;
				const group = grouped.get(key) ?? {
					accountId: transaction.accountId,
					payerLabel: payer.label,
					transactions: [],
					evidence: [],
				};
				group.transactions.push({
					id: transaction.id,
					bookedDate: transaction.bookedDate,
					amount: transaction.amount,
				});
				for (const item of classificationEvidence) {
					if (!group.evidence.some(({ code }) => code === item.code)) {
						group.evidence.push(item);
					}
				}
				grouped.set(key, group);
			}

			const candidates: PayrollCandidate[] = [];
			for (const [key, group] of grouped) {
				const transactions = [...group.transactions].sort(
					(left, right) =>
						left.bookedDate.localeCompare(right.bookedDate) ||
						left.id.localeCompare(right.id),
				);
				const adjacentGaps = transactions
					.slice(1)
					.map((transaction, index) =>
						dayDifference(
							transactions[index]!.bookedDate,
							transaction.bookedDate,
						),
					);
				const medianGap = adjacentGaps.every((gap) => gap > 0)
					? median(adjacentGaps)
					: null;
				const gapTolerance =
					medianGap === null ? null : Math.max(3, medianGap * 0.2);
				const recurring =
					transactions.length >= 3 &&
					medianGap !== null &&
					gapTolerance !== null &&
					medianGap >= 5 &&
					medianGap <= 40 &&
					adjacentGaps.every(
						(gap) => Math.abs(gap - medianGap) <= gapTolerance,
					);
				if (
					!group.evidence.some(
						(item) => item.code === "source.transaction-type",
					) &&
					transactions.length < 3
				)
					continue;
				const identityStrength: EvidenceStrength = group.evidence.some(
					(item) => item.code === "source.transaction-type",
				)
					? "strong"
					: group.evidence.some((item) => item.code === "payer.identity") &&
							group.evidence.some((item) => item.code === "payroll.language")
						? "moderate"
						: "weak";
				const regularityEvidence: EvidenceItem[] = [
					{
						code: recurring
							? "payroll.recurrence"
							: "payroll.irregular-cadence",
						source: "behavioral",
						strength: recurring
							? transactions.length >= 4
								? "strong"
								: "moderate"
							: "weak",
						message: recurring
							? `${transactions.length} deposits support a recurring cadence.`
							: "Deposit dates do not yet establish a consistent cadence.",
						transactionIds: transactions.map(({ id }) => id),
					},
				];
				candidates.push({
					key,
					accountId: group.accountId,
					currency: "USD",
					payerLabel: group.payerLabel,
					transactions: transactions.map(({ id, bookedDate, amount }) => ({
						id,
						bookedDate,
						amount,
					})),
					identityEvidence: summary(group.evidence, identityStrength),
					regularityEvidence: summary(
						regularityEvidence,
						recurring
							? transactions.length >= 4
								? "strong"
								: "moderate"
							: "weak",
					),
					recurring,
				});
			}

			candidates.sort(
				(left, right) =>
					strengthRank(right.identityEvidence.strength) -
						strengthRank(left.identityEvidence.strength) ||
					strengthRank(right.regularityEvidence.strength) -
						strengthRank(left.regularityEvidence.strength) ||
					right.transactions.length - left.transactions.length ||
					left.key.localeCompare(right.key),
			);
			const diagnostics: AnalysisDiagnostic[] = [];
			if (candidates.length === 0) {
				diagnostics.push({
					code: "payroll.none-detected",
					severity: "info",
					message: "No recurring payroll deposits were detected.",
				});
			}
			return { value: { candidates }, diagnostics };
		},
	};
