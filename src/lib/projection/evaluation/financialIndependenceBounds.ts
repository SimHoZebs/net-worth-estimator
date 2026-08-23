import type { IsoDate } from "../types/model";
import { addMonthsClamped } from "../utils/date";

export const FI_SHORTFALL_TOLERANCE = 0.01;

export function minimumAnnualWithdrawals({
	candidateDate,
	evaluationYears,
	expenseAt,
	directIncomeByMonth,
}: {
	candidateDate: IsoDate;
	evaluationYears: number;
	expenseAt(date: IsoDate): number;
	directIncomeByMonth: readonly number[];
}) {
	return Array.from({ length: evaluationYears }, (_, year) => {
		let required = 0;
		for (let month = year * 12; month < (year + 1) * 12; month++) {
			const startDate = addMonthsClamped(candidateDate, month);
			required += Math.max(
				0,
				expenseAt(startDate) / 12 -
					(directIncomeByMonth[month] ?? 0) -
					FI_SHORTFALL_TOLERANCE,
			);
		}
		return required;
	});
}

export function hasInsufficientOptimisticWithdrawalCapacity(
	minimumWithdrawals: readonly number[],
	firstYearCapacity: number,
	laterYearCapacity: number,
) {
	return minimumWithdrawals.some(
		(required, year) =>
			required > (year === 0 ? firstYearCapacity : laterYearCapacity),
	);
}
