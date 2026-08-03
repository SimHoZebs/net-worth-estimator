import type {
	AnalysisDefinition,
	AnalysisDiagnostic,
	EvidenceItem,
	EvidenceStrength,
	EvidenceSummary,
} from "@/lib/analysis";
import type {
	PayrollCandidate,
	PayrollCandidateTransaction,
	PayrollDetectionResult,
} from "./payrollDetection";

export type PayrollCadence =
	| "weekly"
	| "biweekly"
	| "twice-monthly"
	| "monthly";

export type SalaryEstimateStatus = "confirmed" | "provisional" | "unavailable";

export interface SalaryEstimate {
	payerLabel: string;
	accountId: string;
	currency: "USD";
	cadence: PayrollCadence;
	typicalNetDeposit: number;
	annualizedObservedNetPay: {
		low: number;
		midpoint: number;
		high: number;
	} | null;
	identityEvidence: EvidenceSummary;
	regularPayEvidence: EvidenceSummary;
	observationCount: number;
	comparableObservationCount: number;
	supportingTransactionIds: string[];
	excludedTransactionIds: string[];
	limitations: string[];
}

export interface SalaryEstimateResult {
	status: SalaryEstimateStatus;
	estimate: SalaryEstimate | null;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function quantile(values: readonly number[], percentile: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) return 0;
	const index = (sorted.length - 1) * percentile;
	const lower = Math.floor(index);
	const fraction = index - lower;
	return (
		(sorted[lower] ?? 0) +
		fraction *
			((sorted[Math.min(lower + 1, sorted.length - 1)] ?? 0) -
				(sorted[lower] ?? 0))
	);
}

function dayDifference(left: string, right: string): number {
	return (
		(Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) /
		86_400_000
	);
}

function recurringAmountCluster(transactions: PayrollCandidateTransaction[]) {
	let core = [...transactions].sort(
		(left, right) => left.amount - right.amount,
	);
	let ambiguous = false;
	while (core.length >= 4) {
		let largestGap = 0;
		let largestGapIndex = -1;
		for (let index = 1; index < core.length; index++) {
			const gap = core[index]!.amount - core[index - 1]!.amount;
			if (gap > largestGap) {
				largestGap = gap;
				largestGapIndex = index;
			}
		}
		if (largestGapIndex < 0) break;
		const midpoint = median(core.map(({ amount }) => amount));
		const left = core.slice(0, largestGapIndex);
		const right = core.slice(largestGapIndex);
		const dominantSide = left.length === 1 ? right : left;
		const dominantMidpoint = median(dominantSide.map(({ amount }) => amount));
		if (
			largestGap > Math.max(dominantMidpoint * 0.25, 1) &&
			(left.length === 1 || right.length === 1)
		) {
			core = left.length === 1 ? right : left;
			continue;
		}
		if (
			left.length >= 2 &&
			right.length >= 2 &&
			largestGap > Math.max(midpoint * 0.25, 1)
		) {
			ambiguous = true;
		}
		break;
	}
	if (ambiguous) {
		return { included: [], excluded: transactions, ambiguous: true };
	}
	const midpoint = median(core.map(({ amount }) => amount));
	const deviations = core.map(({ amount }) => Math.abs(amount - midpoint));
	const mad = median(deviations);
	const threshold = Math.max(midpoint * 0.2, mad * 3, 1);
	const included = core.filter(
		({ amount }) => Math.abs(amount - midpoint) <= threshold,
	);
	const includedIds = new Set(included.map(({ id }) => id));
	return {
		included,
		excluded: transactions.filter(({ id }) => !includedIds.has(id)),
		ambiguous: false,
	};
}

function weekdayModeRatio(transactions: PayrollCandidateTransaction[]): number {
	const counts = new Map<number, number>();
	for (const transaction of transactions) {
		const weekday = new Date(`${transaction.bookedDate}T00:00:00Z`).getUTCDay();
		counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
	}
	return Math.max(0, ...counts.values()) / transactions.length;
}

function daysInMonth(year: number, month: number): number {
	const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	return (
		[31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
			month - 1
		] ?? 0
	);
}

function twiceMonthlyCalendarPattern(
	transactions: PayrollCandidateTransaction[],
): boolean {
	const descriptorsByMonth = new Map<string, string[]>();
	const observationsByMonth = new Map<string, number>();
	for (const transaction of transactions) {
		const [yearText, monthText, dayText] = transaction.bookedDate.split("-");
		const year = Number(yearText);
		const month = Number(monthText);
		const day = Number(dayText);
		const descriptor = day === daysInMonth(year, month) ? "last" : String(day);
		const key = `${yearText}-${monthText}`;
		observationsByMonth.set(key, (observationsByMonth.get(key) ?? 0) + 1);
		const descriptors = descriptorsByMonth.get(key) ?? [];
		if (!descriptors.includes(descriptor)) descriptors.push(descriptor);
		descriptorsByMonth.set(key, descriptors);
	}
	const monthlyDescriptors = [...descriptorsByMonth.values()];
	if (
		monthlyDescriptors.length < 2 ||
		[...observationsByMonth.values()].some((count) => count !== 2) ||
		monthlyDescriptors.some((descriptors) => descriptors.length !== 2)
	) {
		return false;
	}
	const monthKeys = [...descriptorsByMonth.keys()].sort();
	for (let index = 1; index < monthKeys.length; index++) {
		const previous = monthKeys[index - 1]!.split("-");
		const current = monthKeys[index]!.split("-");
		const previousSerial = Number(previous[0]) * 12 + Number(previous[1]);
		const currentSerial = Number(current[0]) * 12 + Number(current[1]);
		if (currentSerial - previousSerial !== 1) return false;
	}
	for (const [key, descriptors] of descriptorsByMonth) {
		const [yearText, monthText] = key.split("-");
		const year = Number(yearText);
		const month = Number(monthText);
		const days = descriptors
			.map((descriptor) =>
				descriptor === "last" ? daysInMonth(year, month) : Number(descriptor),
			)
			.sort((left, right) => left - right);
		if ((days[1] ?? 0) - (days[0] ?? 0) < 10) return false;
	}
	const signatures = monthlyDescriptors.map((descriptors) =>
		[...descriptors].sort().join("/"),
	);
	return signatures.length >= 2 && new Set(signatures).size === 1;
}

function monthlyCalendarPattern(
	transactions: PayrollCandidateTransaction[],
): boolean {
	const descriptors = new Set<string>();
	for (const transaction of transactions) {
		const [yearText, monthText, dayText] = transaction.bookedDate.split("-");
		const year = Number(yearText);
		const month = Number(monthText);
		const day = Number(dayText);
		descriptors.add(day === daysInMonth(year, month) ? "last" : String(day));
	}
	return descriptors.size === 1;
}

function classifyCadence(transactions: PayrollCandidateTransaction[]): {
	cadence: PayrollCadence;
	annualPeriods: number;
} | null {
	const sorted = [...transactions].sort((left, right) =>
		left.bookedDate.localeCompare(right.bookedDate),
	);
	const gaps = sorted
		.slice(1)
		.map((transaction, index) =>
			dayDifference(sorted[index]!.bookedDate, transaction.bookedDate),
		);
	if (gaps.some((gap) => gap <= 0)) return null;
	const typicalGap = median(gaps);
	const gapDeviation = median(gaps.map((gap) => Math.abs(gap - typicalGap)));
	const weekdayRatio = weekdayModeRatio(sorted);
	const biweeklyLike =
		typicalGap >= 12 &&
		typicalGap <= 16 &&
		gapDeviation <= 3 &&
		weekdayRatio >= 0.75 &&
		gaps.every((gap) => gap >= 12 && gap <= 16);
	const calendarTwiceMonthly = twiceMonthlyCalendarPattern(sorted);
	if (calendarTwiceMonthly && biweeklyLike) {
		return null;
	}
	if (calendarTwiceMonthly) {
		return { cadence: "twice-monthly", annualPeriods: 24 };
	}
	if (
		typicalGap >= 5 &&
		typicalGap <= 9 &&
		gapDeviation <= 2 &&
		weekdayRatio >= 0.75 &&
		gaps.every((gap) => gap >= 5 && gap <= 9)
	) {
		return { cadence: "weekly", annualPeriods: 52 };
	}
	if (biweeklyLike) {
		return { cadence: "biweekly", annualPeriods: 26 };
	}
	if (
		typicalGap >= 25 &&
		typicalGap <= 35 &&
		gapDeviation <= 3 &&
		monthlyCalendarPattern(sorted) &&
		gaps.every((gap) => gap >= 25 && gap <= 35)
	) {
		return { cadence: "monthly", annualPeriods: 12 };
	}
	return null;
}

function strengthRank(strength: EvidenceStrength): number {
	return strength === "strong" ? 3 : strength === "moderate" ? 2 : 1;
}

function candidateScore(candidate: PayrollCandidate): number {
	return (
		strengthRank(candidate.identityEvidence.strength) * 10 +
		strengthRank(candidate.regularityEvidence.strength) * 5 +
		(candidate.recurring ? 2 : 0) +
		Math.min(candidate.transactions.length, 12) / 12
	);
}

function unavailable(diagnostics: AnalysisDiagnostic[]) {
	return {
		value: { status: "unavailable" as const, estimate: null },
		diagnostics,
	};
}

export const salaryEstimateAnalysis: AnalysisDefinition<
	PayrollDetectionResult,
	SalaryEstimateResult
> = {
	id: "salary-estimate",
	label: "Annualized observed net pay",
	run({ input }) {
		const diagnostics: AnalysisDiagnostic[] = [];
		const selected = [...input.candidates]
			.filter((candidate) => candidate.transactions.length >= 2)
			.sort(
				(left, right) =>
					candidateScore(right) - candidateScore(left) ||
					left.key.localeCompare(right.key),
			)[0];
		if (!selected) {
			return unavailable([
				{
					code:
						input.candidates.length > 0
							? "salary.insufficient-history"
							: "salary.no-recurring-payroll",
					severity: "warning",
					message:
						input.candidates.length > 0
							? "At least two comparable payroll deposits are required to show a provisional estimate."
							: "A net-pay estimate needs a recurring payroll deposit series.",
				},
			]);
		}
		const rawTwiceMonthlyPattern = twiceMonthlyCalendarPattern(
			selected.transactions,
		);
		const cluster = recurringAmountCluster(selected.transactions);
		if (cluster.ambiguous) {
			return unavailable([
				{
					code: "salary.multimodal-deposits",
					severity: "warning",
					message:
						"Payroll deposits have multiple materially different recurring amounts, so observed net pay is ambiguous.",
				},
			]);
		}
		if (cluster.included.length < 2) {
			return unavailable([
				{
					code: "salary.insufficient-history",
					severity: "warning",
					message:
						"At least two comparable payroll deposits are required to show a provisional estimate.",
				},
			]);
		}
		const cadence = classifyCadence(cluster.included);
		if (!cadence) {
			return unavailable([
				{
					code: "salary.ambiguous-cadence",
					severity: "warning",
					message:
						"Payroll deposits were found, but their cadence is too irregular or ambiguous to estimate safely.",
				},
			]);
		}
		if (cadence.cadence === "twice-monthly" && !rawTwiceMonthlyPattern) {
			return unavailable([
				{
					code: "salary.ambiguous-cadence",
					severity: "warning",
					message:
						"An additional observed deposit makes the twice-monthly cadence ambiguous.",
				},
			]);
		}
		const amounts = cluster.included.map(({ amount }) => amount);
		if (cluster.excluded.length > 0) {
			diagnostics.push({
				code: "salary.off-cycle-payments-excluded",
				severity: "info",
				message: `${cluster.excluded.length} amount outlier${cluster.excluded.length === 1 ? " was" : "s were"} excluded from the recurring-pay estimate.`,
			});
		}
		const typicalNetDeposit = median(amounts);
		const status: SalaryEstimateStatus =
			cluster.included.length >= 3 ? "confirmed" : "provisional";
		const regularPayEvidenceItems: EvidenceItem[] = [
			{
				code: "regular-pay.comparable-count",
				source: "behavioral",
				strength: status === "confirmed" ? "moderate" : "weak",
				message: `${cluster.included.length} comparable deposit${cluster.included.length === 1 ? "" : "s"} support the regular-pay estimate.`,
				transactionIds: cluster.included.map(({ id }) => id),
			},
			{
				code: `regular-pay.cadence.${cadence.cadence}`,
				source: "behavioral",
				strength: status === "confirmed" ? "moderate" : "weak",
				message:
					status === "confirmed"
						? `${cluster.included.length - 1} observed intervals support a ${cadence.cadence} cadence.`
						: "Only one observed interval supports this cadence; more history is needed.",
			},
		];
		const limitations: string[] = [];
		if (status === "provisional") {
			limitations.push(
				"This is a per-deposit estimate only; annualization is withheld until more comparable history is available.",
			);
		}
		if (cluster.excluded.length > 0) {
			regularPayEvidenceItems.push({
				code: "regular-pay.variable-amount-candidate",
				source: "behavioral",
				strength: "weak",
				message:
					"An amount outlier was excluded from the regular-pay estimate; it is not classified as a bonus.",
				transactionIds: cluster.excluded.map(({ id }) => id),
			});
			limitations.push(
				"Excluded amount candidates may be bonuses, raises, corrections, or other variable compensation.",
			);
		}
		return {
			value: {
				status,
				estimate: {
					payerLabel: selected.payerLabel,
					accountId: selected.accountId,
					currency: "USD",
					cadence: cadence.cadence,
					typicalNetDeposit,
					annualizedObservedNetPay:
						status === "confirmed"
							? {
									low: quantile(amounts, 0.25) * cadence.annualPeriods,
									midpoint: typicalNetDeposit * cadence.annualPeriods,
									high: quantile(amounts, 0.75) * cadence.annualPeriods,
								}
							: null,
					identityEvidence: selected.identityEvidence,
					regularPayEvidence: {
						strength: status === "confirmed" ? "moderate" : "weak",
						items: regularPayEvidenceItems,
					},
					observationCount: selected.transactions.length,
					comparableObservationCount: cluster.included.length,
					supportingTransactionIds: cluster.included.map(({ id }) => id),
					excludedTransactionIds: cluster.excluded.map(({ id }) => id),
					limitations,
				},
			},
			diagnostics,
		};
	},
};
