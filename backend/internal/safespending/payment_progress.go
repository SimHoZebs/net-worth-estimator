package safespending

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// computePaymentProgress totals the non-card bills in the payment window and
// compacts the displayed detail in the same pass. A scheduled repayment owned
// by one tracked card is already represented by the separate card section, so
// it is neither paid cash here nor a bill detail row. computeForecast runs
// first and still reads every repayment from s.Bills, so compaction happens
// after the forecast has consumed its inputs.
func computePaymentProgress(st *cutState) {
	s := st.s
	paid, unpaid := 0.0, 0.0
	paidKnown, unpaidKnown := true, true
	tracked := trackedCards(effectiveCards(st.model, st.settings))
	cardRepayment := make(map[string]bool, len(st.model.Schedules))
	for i := range st.model.Schedules {
		rule := &st.model.Schedules[i]
		if len(rule.Destinations) == 1 && tracked[rule.Destinations[0]] {
			cardRepayment[rule.ID] = true
		}
	}

	kept := make([]types.SafeSpendingBill, 0, len(s.Bills))
	for _, bill := range s.Bills {
		ownedByCard := bill.ScheduleID != nil && cardRepayment[*bill.ScheduleID]
		if !ownedByCard {
			kept = append(kept, bill)
		}
		if ownedByCard || bill.Date > s.PayoffDate {
			continue
		}
		if bill.Status == "paid" {
			if bill.Date >= s.PaymentPeriodStart || (bill.ActualDate != nil && *bill.ActualDate >= s.PaymentPeriodStart) {
				addPaymentAmount(&paid, &paidKnown, bill.Amount)
			}
			continue
		}
		addPaymentAmount(&unpaid, &unpaidKnown, bill.Amount)
	}
	sortBills(kept)
	if paidKnown {
		s.PaidByPayday = money(paid)
	}
	if unpaidKnown {
		s.UnpaidByPayday = money(unpaid)
	}
	s.Bills = kept
}

func addPaymentAmount(total *float64, known *bool, amount *float64) {
	if amount == nil || *amount < 0 {
		*known = false
		return
	}
	*total += *amount
}
