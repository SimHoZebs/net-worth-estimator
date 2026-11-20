package types

// CardStatement is an owner-entered record of one actual card statement. The
// close date is an observed fact, not a day-of-month setting: it is separate
// from Account.StatementClosingDay, which remains the recurring cycle anchor
// used by the forecast. The recorded balance is the billed amount owed and is
// authoritative evidence for this statement only; it never turns a replay
// estimate into a confirmed statement.
type CardStatement struct {
	ID          string  `json:"id"`
	AccountID   string  `json:"accountId"`
	ClosingDate IsoDate `json:"closingDate"`
	DueDate     IsoDate `json:"dueDate"`
	Balance     float64 `json:"balance"`
	Currency    string  `json:"currency"`
	Source      string  `json:"source,omitempty"`
	Note        string  `json:"note,omitempty"`
	CreatedAt   int64   `json:"createdAt"`
}

// StatementAllocation records the owner's explicit decision that one posted
// payment settles part of one statement. The payment stays a cash transfer in
// the model; an allocation annotates it and never moves money. One payment
// backs at most one allocation so both transfer legs are never counted twice.
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

// StatementAllocationEvent is one append-only audit entry for an allocation's
// state changes. It carries identity, action, actor, and time, never evidence.
type StatementAllocationEvent struct {
	ID           int64  `json:"id"`
	AllocationID string `json:"allocationId"`
	Action       string `json:"action"`
	Actor        string `json:"actor,omitempty"`
	CreatedAt    int64  `json:"createdAt"`
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

// StatementPaymentSuggestion is one statement a posted payment could settle.
// The read carries the statement's remaining balance; the payment carries the
// advisory evidence for this specific pairing. Neither is a claim.
type StatementPaymentSuggestion struct {
	Read    StatementAllocationRead `json:"read"`
	Payment PaymentCandidate        `json:"payment"`
}

// StatementPaymentSuggestionResult describes the current allocation state of
// the canonical payment behind a suggestion list.
type StatementPaymentSuggestionResult struct {
	Status      string  `json:"status"` // "unallocated", "applied", or "dismissed"
	StatementID string  `json:"statementId,omitempty"`
	Amount      float64 `json:"amount,omitempty"`
}

// StatementAllocationRead pairs a recorded statement with its allocations and
// the running totals used to validate partial payments. Allocated is the sum
// of confirmed allocations; Remaining is the billed balance still to allocate.
type StatementAllocationRead struct {
	Statement   CardStatement         `json:"statement"`
	Allocations []StatementAllocation `json:"allocations"`
	Allocated   float64               `json:"allocated"`
	Remaining   float64               `json:"remaining"`
}
