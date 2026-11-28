package types

import "time"

// DerivedStatement is one card statement reconstructed from the card's
// closing-day cadence and recorded bank evidence. It is never owner-authored.
// A closed statement starts from the latest balance check inside its cycle and
// applies posted activity after that check through the close. A close without
// an in-cycle check stays unknown instead of borrowing an older balance.
type DerivedStatement struct {
	ID          string   `json:"id"`
	AccountID   string   `json:"accountId"`
	ClosingDate IsoDate  `json:"closingDate"`
	DueDate     *IsoDate `json:"dueDate"`
	Balance     *float64 `json:"balance"`
	Kind        string   `json:"kind"` // "closed", "estimated", or "unknown"
	Currency    string   `json:"currency"`
}

// DerivedStatementID is the canonical wire identity for a derived statement.
// The closing date is fixed-width and comes first, so the remainder is always
// the account id even when that id contains separators of its own.
func DerivedStatementID(accountID string, closingDate IsoDate) string {
	return string(closingDate) + "~" + accountID
}

// ParseDerivedStatementID splits a derived statement identity back into its
// account id and closing date. The first ten characters are the ISO date and
// character ten is the separator; a malformed id is rejected rather than
// guessed at.
func ParseDerivedStatementID(id string) (accountID string, closingDate IsoDate, ok bool) {
	if len(id) < 12 || id[10] != '~' || !isValidIsoDate(id[:10]) {
		return "", "", false
	}
	return id[11:], IsoDate(id[:10]), true
}

// isValidIsoDate mirrors domain.ParseIsoDate without importing domain, which
// would create a cycle. It requires an exact, zero-padded YYYY-MM-DD calendar
// date so a malformed derived identity is never accepted.
func isValidIsoDate(value string) bool {
	if len(value) != 10 {
		return false
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, time.UTC)
	return err == nil && parsed.Format("2006-01-02") == value
}

// StatementAllocation records the owner's explicit decision that one posted
// payment settles part of one derived statement. The payment stays a cash
// transfer in the model; an allocation annotates it and never moves money. One
// payment backs at most one allocation so both transfer legs are never counted
// twice. StatementID is a derived statement identity (accountId + closingDate).
type StatementAllocation struct {
	ID            string  `json:"id"`
	StatementID   string  `json:"statementId"`
	TransactionID string  `json:"transactionId"`
	Amount        float64 `json:"amount"`
	State         string  `json:"state"`
	Evidence      string  `json:"evidence"`
	Actor         string  `json:"actor,omitempty"`
	CreatedAt     int64   `json:"createdAt"`
	UpdatedAt     int64   `json:"updatedAt"`
}

// PaymentEvidence is one reason a posted payment is shown as a candidate for
// a statement. It is advisory: the owner allocates explicitly, never by amount
// alone.
type PaymentEvidence struct {
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

// PaymentCandidate is a posted payment that could settle a statement. It is a
// read-only hint with evidence, not a claim. AllocatedToStatementId is set
// when the payment already backs an allocation, so a second allocation is
// rejected and a transfer is never counted twice.
type PaymentCandidate struct {
	TransactionID          string            `json:"transactionId"`
	Name                   string            `json:"name"`
	Amount                 float64           `json:"amount"`
	PostedDate             IsoDate           `json:"postedDate"`
	Currency               string            `json:"currency"`
	DayGapToDue            *int              `json:"dayGapToDue,omitempty"`
	AmountDelta            float64           `json:"amountDelta,omitempty"`
	Evidence               []PaymentEvidence `json:"evidence"`
	AllocatedToStatementID *string           `json:"allocatedToStatementId,omitempty"`
}

// StatementPaymentSuggestion is one derived statement a posted payment could
// settle. The read carries the statement's remaining balance; the payment
// carries the advisory evidence for this specific pairing. Neither is a claim.
type StatementPaymentSuggestion struct {
	Read    StatementAllocationRead `json:"read"`
	Payment PaymentCandidate        `json:"payment"`
}

// StatementAllocationRead pairs a derived statement with its allocations and
// the running totals used to validate partial payments. Allocated is the sum
// of confirmed allocations; Remaining is the billed balance still to allocate.
// A statement whose balance is unknown cannot back an allocation.
type StatementAllocationRead struct {
	Statement   DerivedStatement      `json:"statement"`
	Allocations []StatementAllocation `json:"allocations"`
	Allocated   float64               `json:"allocated"`
	Remaining   float64               `json:"remaining"`
}
