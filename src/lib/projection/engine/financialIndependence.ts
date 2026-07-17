import type {
	FinancialIndependenceAnalysis,
	FinancialIndependencePlan,
	FinancialIndependenceRunOutcome,
	IsoDate,
	Posting,
	ProjectionRow,
} from "../types/scenario";
import { addYearsClamped, daysBetween } from "../utils/date";

const EPSILON = 0.01;

export const DEFAULT_FI_PLAN: FinancialIndependencePlan = {
	annualExpenseTarget: 0,
	annualExpenseGrowthRate: 0,
	withdrawalRate: 0,
	evaluationYears: 1,
	requiredConfidence: 1,
	sources: [],
	principalPolicy: "allow-drawdown",
};

function selectedAssetRates(plan: FinancialIndependencePlan) {
	const rates = new Map<string, number>();
	for (const source of plan.sources) {
		if (source.type === "asset" && source.included) {
			rates.set(
				source.accountId,
				source.withdrawalRateOverride ?? plan.withdrawalRate,
			);
		}
	}
	return rates;
}

function selectedCashflowIds(plan: FinancialIndependencePlan) {
	const ids = new Set<string>();
	for (const source of plan.sources) {
		if (source.type === "cashflow" && source.included) {
			ids.add(source.postingId);
		}
	}
	return ids;
}

function balanceAt(row: ProjectionRow, accountId: string) {
	return (
		row.accountSnapshots.find((snapshot) => snapshot.accountId === accountId)
			?.balance ?? 0
	);
}

function latestRowAtOrBefore(rows: ProjectionRow[], date: IsoDate) {
	let match: ProjectionRow | null = null;
	for (const row of rows) {
		if (row.date > date) break;
		match = row;
	}
	return match;
}

function expenseAt(
	plan: FinancialIndependencePlan,
	projectionStartDate: IsoDate,
	date: IsoDate,
) {
	const years = Math.max(0, daysBetween(projectionStartDate, date) / 365.2425);
	return plan.annualExpenseTarget * (1 + plan.annualExpenseGrowthRate) ** years;
}

function evaluateCycle(
	rows: ProjectionRow[],
	postingsById: Map<string, Posting>,
	plan: FinancialIndependencePlan,
	projectionStartDate: IsoDate,
	projectionEndDate: IsoDate,
	candidateDate: IsoDate,
): FinancialIndependenceRunOutcome | null {
	const cycleEnd = addYearsClamped(candidateDate, plan.evaluationYears);
	if (cycleEnd > projectionEndDate) return null;

	const assetRates = selectedAssetRates(plan);
	const cashflowIds = selectedCashflowIds(plan);
	const candidateRow = latestRowAtOrBefore(rows, candidateDate);
	if (!candidateRow) return null;

	const virtualBalances = new Map(
		[...assetRates.keys()].map((accountId) => [
			accountId,
			Math.max(0, balanceAt(candidateRow, accountId)),
		]),
	);
	const startingSelectedAssetBalance = [...virtualBalances.values()].reduce(
		(sum, balance) => sum + balance,
		0,
	);
	let hadWithdrawalShortfall = false;
	const rowsByYear = Array.from(
		{ length: plan.evaluationYears },
		() => [] as ProjectionRow[],
	);
	let cycleYear = 0;
	for (const row of rows) {
		if (row.date <= candidateDate || row.date > cycleEnd) continue;
		while (
			cycleYear < plan.evaluationYears - 1 &&
			row.date > addYearsClamped(candidateDate, cycleYear + 1)
		) {
			cycleYear++;
		}
		rowsByYear[cycleYear].push(row);
	}

	for (let year = 0; year < plan.evaluationYears; year++) {
		const periodStart = addYearsClamped(candidateDate, year);

		for (const row of rowsByYear[year]) {
			for (const snapshot of row.accountSnapshots) {
				if (!virtualBalances.has(snapshot.accountId)) continue;
				for (const impact of snapshot.impacts) {
					const posting = postingsById.get(impact.postingId);
					if (!posting || posting.annualRate === 0) continue;
					const baselineBalance = Math.max(
						EPSILON,
						snapshot.balance - impact.delta,
					);
					const virtualBalance = virtualBalances.get(snapshot.accountId) ?? 0;
					virtualBalances.set(
						snapshot.accountId,
						Math.max(
							0,
							virtualBalance +
								impact.delta * (virtualBalance / baselineBalance),
						),
					);
				}
			}
		}

		let directIncome = 0;
		for (const row of rowsByYear[year]) {
			for (const postingId of cashflowIds) {
				directIncome += row.realizedPostingAmountsById[postingId] ?? 0;
			}
		}
		const requiredExpense = expenseAt(plan, projectionStartDate, periodStart);
		let withdrawal = Math.max(0, requiredExpense - directIncome);
		const available = [...virtualBalances.values()].reduce(
			(sum, balance) => sum + balance,
			0,
		);
		if (withdrawal > available + EPSILON) {
			hadWithdrawalShortfall = true;
			withdrawal = available;
		}

		if (withdrawal > 0 && available > 0) {
			for (const [accountId, balance] of virtualBalances) {
				virtualBalances.set(
					accountId,
					Math.max(0, balance - withdrawal * (balance / available)),
				);
			}
		}
	}

	const endingSelectedAssetBalance = [...virtualBalances.values()].reduce(
		(sum, balance) => sum + balance,
		0,
	);
	const inflationFactor =
		(1 + plan.annualExpenseGrowthRate) ** plan.evaluationYears;
	const startingRealSelectedAssetBalance = startingSelectedAssetBalance;
	const endingRealSelectedAssetBalance =
		inflationFactor > 0
			? endingSelectedAssetBalance / inflationFactor
			: endingSelectedAssetBalance;
	const principalReplenished =
		plan.principalPolicy === "allow-drawdown" ||
		(plan.principalPolicy === "preserve-nominal-principal"
			? endingSelectedAssetBalance + EPSILON >= startingSelectedAssetBalance
			: endingRealSelectedAssetBalance + EPSILON >=
				startingRealSelectedAssetBalance);

	return {
		candidateDate,
		expensesFullyCovered: !hadWithdrawalShortfall,
		hadWithdrawalShortfall,
		startingSelectedAssetBalance,
		endingSelectedAssetBalance,
		startingRealSelectedAssetBalance,
		endingRealSelectedAssetBalance,
		principalReplenished,
		cycleEstablished: !hadWithdrawalShortfall && principalReplenished,
	};
}

export function evaluateFinancialIndependence({
	rows,
	postings,
	plan,
	projectionStartDate,
	projectionEndDate,
}: {
	rows: ProjectionRow[];
	postings: Posting[];
	plan: FinancialIndependencePlan;
	projectionStartDate: IsoDate;
	projectionEndDate: IsoDate;
}): FinancialIndependenceAnalysis {
	const normalizedPlan = {
		...plan,
		evaluationYears: Math.max(1, Math.floor(plan.evaluationYears)),
	};
	const projectedRows = rows.filter((row) => !row.isHistorical);
	const assetRates = selectedAssetRates(normalizedPlan);
	const cashflowIds = selectedCashflowIds(normalizedPlan);
	const postingsById = new Map(
		postings.map((posting) => [posting.id, posting]),
	);
	const cashflowPrefix = [0];
	for (const row of projectedRows) {
		let amount = 0;
		for (const postingId of cashflowIds) {
			amount += row.realizedPostingAmountsById[postingId] ?? 0;
		}
		cashflowPrefix.push(cashflowPrefix[cashflowPrefix.length - 1] + amount);
	}
	let incomeWindowEnd = 0;
	const analysisRows = projectedRows.map((row, rowIndex) => {
		const periodEnd = addYearsClamped(row.date, 1);
		incomeWindowEnd = Math.max(incomeWindowEnd, rowIndex + 1);
		while (
			incomeWindowEnd < projectedRows.length &&
			projectedRows[incomeWindowEnd].date <= periodEnd
		) {
			incomeWindowEnd++;
		}
		const annualDirectIncome =
			cashflowPrefix[incomeWindowEnd] - cashflowPrefix[rowIndex + 1];
		let selectedAssetBalance = 0;
		let annualWithdrawalCapacity = 0;
		for (const [accountId, rate] of assetRates) {
			const balance = Math.max(0, balanceAt(row, accountId));
			selectedAssetBalance += balance;
			annualWithdrawalCapacity += balance * Math.max(0, rate);
		}
		const annualExpenseTarget = expenseAt(
			normalizedPlan,
			projectionStartDate,
			row.date,
		);
		const totalAnnualCapacity = annualDirectIncome + annualWithdrawalCapacity;
		const coverageRatio =
			annualExpenseTarget <= 0
				? totalAnnualCapacity > 0
					? Number.POSITIVE_INFINITY
					: 0
				: totalAnnualCapacity / annualExpenseTarget;
		return {
			date: row.date,
			annualDirectIncome,
			selectedAssetBalance,
			annualWithdrawalCapacity,
			totalAnnualCapacity,
			annualExpenseTarget,
			coverageRatio,
			isCovered: annualExpenseTarget > 0 && coverageRatio >= 1,
		};
	});

	const evaluatedMonths = new Set<string>();
	const runOutcomes = analysisRows
		.filter((row) => {
			if (!row.isCovered) return false;
			const month = row.date.slice(0, 7);
			if (evaluatedMonths.has(month)) return false;
			evaluatedMonths.add(month);
			return true;
		})
		.map((row) =>
			evaluateCycle(
				projectedRows,
				postingsById,
				normalizedPlan,
				projectionStartDate,
				projectionEndDate,
				row.date,
			),
		)
		.filter(
			(outcome): outcome is FinancialIndependenceRunOutcome => outcome !== null,
		);

	return {
		rows: analysisRows,
		runOutcomes,
		milestones: {
			firstCoverageDate:
				analysisRows.find((row) => row.isCovered)?.date ?? null,
			firstSelfSustainingDate:
				runOutcomes.find((outcome) => outcome.cycleEstablished)
					?.candidateDate ?? null,
		},
	};
}
