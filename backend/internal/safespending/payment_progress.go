package safespending

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

func computePaymentProgress(st *cutState) {
	s := st.s
	paid, unpaid := 0.0, 0.0
	paidKnown, unpaidKnown := true, s.StatementReserve != nil
	if unpaidKnown {
		unpaid = *s.StatementReserve
	}
	seen := map[string]bool{}
	for _, bill := range s.Bills {
		if bill.TransactionID != nil {
			// A claim keeps its ownership even if its payment posts early.
			seen[*bill.TransactionID] = true
		}
		if bill.Date > s.PayoffDate {
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
	cards := effectiveCards(st.model, st.settings)
	for _, tx := range st.transactions {
		if seen[tx.ID] || !posted(tx, st.cut) || tx.SourceAccountID == nil || !st.selected[*tx.SourceAccountID] {
			continue
		}
		date := postingDay(tx)
		if date < s.PaymentPeriodStart || date > s.PayoffDate {
			continue
		}
		for _, card := range cards {
			if card.ID == *tx.SourceAccountID || !contains(tx.Destinations, card.ID) {
				continue
			}
			if len(tx.Destinations) != 1 {
				paidKnown = false
				break
			}
			var amount *float64
			if value, ok := st.ctx.latest[tx.ID]; ok {
				amount = money(value)
			}
			addPaymentAmount(&paid, &paidKnown, amount)
			s.Bills = append(s.Bills, types.SafeSpendingBill{
				ID: "transaction:" + tx.ID, TransactionID: &tx.ID, ActualDate: &date,
				AccountID: *tx.SourceAccountID, Name: tx.Name, Date: date, Amount: amount, Status: "paid",
			})
			break
		}
	}
	sortBills(s.Bills)
	if paidKnown {
		s.PaidByPayday = money(paid)
	}
	if unpaidKnown {
		s.UnpaidByPayday = money(unpaid)
	}
}

func addPaymentAmount(total *float64, known *bool, amount *float64) {
	if amount == nil || *amount < 0 {
		*known = false
		return
	}
	*total += *amount
}
