package domain

import ()

// FI shortfall bounds ported from evaluation/financialIndependenceBounds.ts.

const FIShortfallTolerance = 0.01

// MinimumAnnualWithdrawals computes the minimum withdrawal per cycle year.
func MinimumAnnualWithdrawals(candidateDate IsoDate, evaluationYears int, expenseAt func(IsoDate) float64, directIncomeByMonth []float64) []float64 {
	out := make([]float64, 0, evaluationYears)
	for year := 0; year < evaluationYears; year++ {
		required := 0.0
		for month := year * 12; month < (year+1)*12; month++ {
			startDate := AddMonthsClamped(candidateDate, month)
			income := 0.0
			if month < len(directIncomeByMonth) {
				income = directIncomeByMonth[month]
			}
			required += maxFloat(0, expenseAt(startDate)/12-income-FIShortfallTolerance)
		}
		out = append(out, required)
	}
	return out
}

// HasInsufficientOptimisticWithdrawalCapacity reports a hopeless candidate.
func HasInsufficientOptimisticWithdrawalCapacity(minimumWithdrawals []float64, firstYearCapacity, laterYearCapacity float64) bool {
	for year, required := range minimumWithdrawals {
		capacity := laterYearCapacity
		if year == 0 {
			capacity = firstYearCapacity
		}
		if required > capacity {
			return true
		}
	}
	return false
}
