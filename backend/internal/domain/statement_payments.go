package domain

import (
	"math"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// paymentEvidence is the normalized semantic payment built from one direct
// transfer or from the two legs of a confirmed transfer link. Normalizing
// never changes the model: the legs stay cash activity exactly as recorded.
type paymentEvidence struct {
	ID             string // canonical leg identity used for apply and lookups
	Name           string
	PayerAccountID string
	CardAccountID  string
	Amount         float64
	PostedDate     string
}

// paymentCandidate builds advisory evidence for one semantic payment against
// one statement. basis is the amount measured against: the billed balance for
// a statement's candidate list, or remaining (billed minus confirmed
// allocations) for a payment's suggestions. Similarity is evidence, never
// proof and never an automatic claim.
func paymentCandidate(statement types.DerivedStatement, payment paymentEvidence, taken map[string]string, basis float64) *types.PaymentCandidate {
	if !IsValidIsoDate(payment.PostedDate) || CompareIsoDates(payment.PostedDate, statement.ClosingDate) < 0 {
		return nil
	}
	basisCents, amountCents := MoneyCents(basis), MoneyCents(payment.Amount)
	evidence := []types.PaymentEvidence{
		{Code: "posted-after-close", Reason: "Payment posted on or after the derived statement close."},
		{Code: "currency-match", Reason: "Payment currency matches the statement currency."},
	}
	gap := 0
	if statement.DueDate != nil {
		gap = isoDayDelta(*statement.DueDate, payment.PostedDate)
	}
	if math.Abs(float64(gap)) <= 7 {
		evidence = append(evidence, types.PaymentEvidence{Code: "near-due-date", Reason: "Payment posts within seven days of the statement due date."})
	}
	switch {
	case basisCents == amountCents:
		evidence = append(evidence, types.PaymentEvidence{Code: "amount-exact", Reason: "Payment amount equals the amount still owed on the statement."})
	case amountCents < basisCents:
		evidence = append(evidence, types.PaymentEvidence{Code: "amount-partial", Reason: "Payment can be applied in part to the amount still owed."})
	default:
		evidence = append(evidence, types.PaymentEvidence{Code: "amount-exceeds", Reason: "Payment exceeds the amount still owed; only part can be applied here."})
	}
	candidate := &types.PaymentCandidate{
		TransactionID: payment.ID,
		Name:          payment.Name,
		Amount:        payment.Amount,
		PostedDate:    payment.PostedDate,
		Currency:      DefaultCardStatementCurrency,
		AmountDelta:   MoneyFromCents(basisCents - amountCents),
		Evidence:      evidence,
	}
	if gap != 0 {
		value := gap
		candidate.DayGapToDue = &value
	}
	if statementID, taken := taken[payment.ID]; taken && statementID != "" {
		candidate.AllocatedToStatementID = &statementID
	}
	return candidate
}

// directPayment recognizes a single-row transfer from a cash or investment
// account into the statement's card.
func directPayment(model *types.FinancialModel, tx types.Transaction, statementAccounts map[string]bool) *paymentEvidence {
	if !tx.Enabled || tx.Pending || tx.Void || tx.SourceAccountID == nil || len(tx.Destinations) != 1 || !statementAccounts[tx.Destinations[0]] {
		return nil
	}
	if !isCashPayer(model, *tx.SourceAccountID) {
		return nil
	}
	cents, ok := autoClaimLiteralCents(tx.Amount)
	if !ok || cents <= 0 {
		return nil
	}
	return &paymentEvidence{
		ID: tx.ID, Name: tx.Name, PayerAccountID: *tx.SourceAccountID,
		CardAccountID: tx.Destinations[0], Amount: MoneyFromCents(cents),
		PostedDate: transactionPostingDay(tx),
	}
}

// linkedPayment normalizes the two legs of a confirmed transfer link into one
// semantic payment. Synced legs have no single row carrying both accounts: an
// external checking outflow has a source and no destination, and an external
// card inflow has no source and one destination. The canonical identity is the
// cash outflow leg so apply and both modal lookups agree on one ID.
func linkedPayment(model *types.FinancialModel, first, second types.Transaction, statementAccounts map[string]bool) *paymentEvidence {
	var outflow, inflow *types.Transaction
	for _, candidate := range []*types.Transaction{&first, &second} {
		tx := *candidate
		if !tx.Enabled || tx.Pending || tx.Void {
			continue
		}
		if tx.SourceAccountID != nil && len(tx.Destinations) == 0 && isCashPayer(model, *tx.SourceAccountID) {
			outflow = candidate
		}
		if tx.SourceAccountID == nil && len(tx.Destinations) == 1 && statementAccounts[tx.Destinations[0]] {
			inflow = candidate
		}
	}
	if outflow == nil || inflow == nil {
		return nil
	}
	outCents, outOK := autoClaimLiteralCents(outflow.Amount)
	inCents, inOK := autoClaimLiteralCents(inflow.Amount)
	if (!outOK && !inOK) || (outOK && outCents <= 0) || (inOK && inCents <= 0) {
		return nil
	}
	// The cash outflow is the amount actually paid. Fall back to the card
	// inflow only when the outflow cannot be priced.
	cents, name := outCents, outflow.Name
	if !outOK {
		cents, name = inCents, inflow.Name
	}
	posted := transactionPostingDay(*inflow)
	if !IsValidIsoDate(posted) {
		posted = transactionPostingDay(*outflow)
	}
	return &paymentEvidence{
		ID: outflow.ID, Name: name, PayerAccountID: *outflow.SourceAccountID,
		CardAccountID: inflow.Destinations[0], Amount: MoneyFromCents(cents),
		PostedDate: posted,
	}
}

func transactionPostingDay(tx types.Transaction) string {
	stamp := tx.PostedTime
	if stamp <= 0 {
		stamp = tx.TransactionTime
	}
	if stamp <= 0 {
		return ""
	}
	return FormatIsoDate(time.Unix(stamp, 0).UTC())
}

// resolvePayment normalizes the transaction named by a modal into one semantic
// payment, using either the direct route or a confirmed transfer link.
func resolvePayment(model *types.FinancialModel, links []types.TransferLink, transactionID string, statementAccounts map[string]bool) *paymentEvidence {
	input, found := findModelTransaction(model, transactionID)
	if !found {
		return nil
	}
	if direct := directPayment(model, input, statementAccounts); direct != nil {
		return direct
	}
	for _, link := range links {
		var peerID string
		switch input.ID {
		case link.LegA:
			peerID = link.LegB
		case link.LegB:
			peerID = link.LegA
		default:
			continue
		}
		peer, found := findModelTransaction(model, peerID)
		if !found {
			continue
		}
		if linked := linkedPayment(model, input, peer, statementAccounts); linked != nil {
			return linked
		}
	}
	return nil
}

// StatementPaymentCandidate resolves one named transaction into a candidate
// for one statement, covering both the direct and confirmed-link routes.
func StatementPaymentCandidate(model *types.FinancialModel, links []types.TransferLink, statement types.DerivedStatement, transactionID string, taken map[string]string) *types.PaymentCandidate {
	if statement.Balance == nil {
		return nil
	}
	payment := resolvePayment(model, links, transactionID, map[string]bool{statement.AccountID: true})
	if payment == nil || payment.CardAccountID != statement.AccountID {
		return nil
	}
	return paymentCandidate(statement, *payment, taken, *statement.Balance)
}

// ResolveCanonicalPaymentID returns the single leg identity used by apply and
// both modal lookups. It is stable whether the caller names the direct transfer
// or either leg of a confirmed transfer link.
func ResolveCanonicalPaymentID(model *types.FinancialModel, links []types.TransferLink, transactionID string, statementAccountIDs map[string]bool) string {
	payment := resolvePayment(model, links, transactionID, statementAccountIDs)
	if payment == nil {
		return transactionID
	}
	return payment.ID
}

// StatementPaymentSuggestions answers one payment's "which statement does
// this settle" question in a single call. It resolves card identity from a
// direct manual transfer or a confirmed transfer link, ranks every statement
// against remaining (billed balance minus confirmed allocations), and returns
// the canonical leg identity for apply and current-allocation lookups.
func StatementPaymentSuggestions(model *types.FinancialModel, links []types.TransferLink, transactionID string, reads []types.StatementAllocationRead, taken map[string]string) ([]types.StatementPaymentSuggestion, string) {
	matches := []types.StatementPaymentSuggestion{}
	if model == nil || transactionID == "" {
		return matches, transactionID
	}
	statementAccounts := map[string]bool{}
	for _, read := range reads {
		statementAccounts[read.Statement.AccountID] = true
	}
	payment := resolvePayment(model, links, transactionID, statementAccounts)
	if payment == nil {
		return matches, transactionID
	}
	for _, read := range reads {
		if read.Statement.AccountID != payment.CardAccountID || read.Statement.Balance == nil {
			continue
		}
		candidate := paymentCandidate(read.Statement, *payment, taken, read.Remaining)
		if candidate == nil {
			continue
		}
		matches = append(matches, types.StatementPaymentSuggestion{Read: read, Payment: *candidate})
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if (a.Payment.AllocatedToStatementID == nil) != (b.Payment.AllocatedToStatementID == nil) {
			return a.Payment.AllocatedToStatementID == nil
		}
		if hasEvidence(a.Payment.Evidence, "amount-exact") != hasEvidence(b.Payment.Evidence, "amount-exact") {
			return hasEvidence(a.Payment.Evidence, "amount-exact")
		}
		aGap := abs64(MoneyCents(a.Read.Remaining) - MoneyCents(a.Payment.Amount))
		bGap := abs64(MoneyCents(b.Read.Remaining) - MoneyCents(b.Payment.Amount))
		if aGap != bGap {
			return aGap < bGap
		}
		if abs(deref(a.Payment.DayGapToDue)) != abs(deref(b.Payment.DayGapToDue)) {
			return abs(deref(a.Payment.DayGapToDue)) < abs(deref(b.Payment.DayGapToDue))
		}
		return a.Read.Statement.ClosingDate < b.Read.Statement.ClosingDate
	})
	return matches, payment.ID
}

// ConfirmedAllocationCardsResolvable verifies that every confirmed allocation
// still has a card identity after a proposed transfer-link removal. It fails
// closed: a link that would strand a live allocation is rejected.
func ConfirmedAllocationCardsResolvable(model *types.FinancialModel, links []types.TransferLink, allocations []types.StatementAllocation, statements []types.DerivedStatement) bool {
	statementAccounts := map[string]bool{}
	for _, statement := range statements {
		statementAccounts[statement.AccountID] = true
	}
	for _, allocation := range allocations {
		if allocation.State != "confirmed" {
			continue
		}
		if resolvePayment(model, links, allocation.TransactionID, statementAccounts) == nil {
			return false
		}
	}
	return true
}

func findModelTransaction(model *types.FinancialModel, id string) (types.Transaction, bool) {
	for _, tx := range model.Transactions {
		if tx.ID == id {
			return tx, true
		}
	}
	return types.Transaction{}, false
}

func isCashPayer(model *types.FinancialModel, accountID string) bool {
	for _, account := range model.Accounts {
		if account.ID == accountID && (account.Kind == types.AccountKindCash || account.Kind == types.AccountKindInvestment) {
			return true
		}
	}
	return false
}

func hasEvidence(evidence []types.PaymentEvidence, code string) bool {
	for _, item := range evidence {
		if item.Code == code {
			return true
		}
	}
	return false
}

func deref(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func abs64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func isoDayDelta(date, other string) int {
	left, errLeft := time.Parse(time.DateOnly, date)
	right, errRight := time.Parse(time.DateOnly, other)
	if errLeft != nil || errRight != nil {
		return 0
	}
	return int(right.Sub(left).Hours() / 24)
}
