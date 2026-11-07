package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// The visible loan reaches a balance target only when its complete balance
// does. Paying principal alone cannot mark outstanding interest as paid off.
func evaluateDisplayAccountBalance(path *types.ProjectionPath, display *types.AccountDisplay, target float64) AccountBalancePathResult {
	for _, row := range path.Rows {
		if row.IsHistorical {
			continue
		}
		total, complete := 0.0, true
		for _, component := range display.Components {
			balance, present := accountBalanceInRow(&row, component.AccountID)
			if !present {
				complete = false
				break
			}
			total += balance
		}
		if complete && total >= target {
			date := string(row.Date)
			return AccountBalancePathResult{Reached: true, FirstReachedDate: &date}
		}
	}
	return AccountBalancePathResult{}
}
