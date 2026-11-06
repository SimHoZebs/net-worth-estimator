// Split settlement ledger (SOC-05). Settlements record real-world payoff
// against versioned split obligations (SOC-04B) without moving money:
// recording a settlement writes only settlement rows, never transactions,
// checkpoints, accounts, or balances, so share acceptance and settlement
// alike synthesize no cash movement.
//
// A settlement names one split plus the participant whose obligation it
// reduces, a positive integer-minor-unit amount, and an optional link to
// one real payment (an owner-scoped transaction). Linked payments are never
// double-counted: one real payment backs at most one settlement record.
// Rows are append-only; ListSettlements exposes the full history in
// record order.
//
// Settlement states are derived, never stored: given what each
// participant owes (their split share, owned by the split layer) plus the
// recorded settlements, SummarizeSettlements reports per-participant
// owed, settled, and outstanding amounts with one of the
// outstanding/partially-settled/settled states.
//
// The payer-versus-beneficiary distinction for unevenly paid expenses is
// out of scope: every settlement reduces exactly one participant's
// obligation by its amount, regardless of who sent the money.
package store

import (
	"fmt"
	"sort"
)

// Settlement lifecycle states derived by SummarizeSettlements. A share
// with nothing recorded is outstanding; a share with some but not full
// coverage is partially-settled; a share covered in full (or owed
// nothing) is settled.
const (
	SettlementStateOutstanding      = "outstanding"
	SettlementStatePartiallySettled = "partially-settled"
	SettlementStateSettled          = "settled"
)

// Settlement is one recorded payoff against one participant's share of
// one split. AmountMinor is a positive integer-minor-unit payment the
// recorder observed in the real world. LinkedOwnerID plus
// LinkedTransactionID optionally names the real payment backing this record;
// both are empty when the settlement was recorded without a link.
type Settlement struct {
	ID                  string `json:"id"`
	SplitID             string `json:"splitId"`
	ParticipantID       string `json:"participantId"`
	AmountMinor         int64  `json:"amountMinor"`
	LinkedOwnerID       string `json:"linkedOwnerId,omitempty"`
	LinkedTransactionID string `json:"linkedTransactionId,omitempty"`
	ActorID             string `json:"actorId"`
	RequestID           string `json:"requestId"`
	CreatedAt           int64  `json:"createdAt"`
}

// Linked reports whether the settlement names a backing real payment.
func (s Settlement) Linked() bool {
	return s.LinkedOwnerID != "" && s.LinkedTransactionID != ""
}

// SettlementInput describes one settlement to record. SplitID names the
// split obligation (SOC-04B owns split identity and membership);
// ParticipantID names whose obligation the payment reduces; AmountMinor
// is the positive integer-minor-unit payment observed. LinkedOwnerID
// plus LinkedTransactionID optionally link the record to one real payment;
// the pair must be set together or not at all.
type SettlementInput struct {
	SplitID             string
	ParticipantID       string
	AmountMinor         int64
	LinkedOwnerID       string
	LinkedTransactionID string
}

// ParticipantSettlement is one participant's derived settlement position:
// what they owe, what has been recorded, what remains, and the resulting
// state. OutstandingMinor never goes negative: overpayment reports
// settled with zero outstanding.
type ParticipantSettlement struct {
	ParticipantID    string `json:"participantId"`
	OwedMinor        int64  `json:"owedMinor"`
	SettledMinor     int64  `json:"settledMinor"`
	OutstandingMinor int64  `json:"outstandingMinor"`
	State            string `json:"state"`
}

// SummarizeSettlements derives one settlement position per participant
// from what each owes plus the recorded settlement history. owed maps
// participant IDs to integer-minor-unit shares and is owned by the
// caller (the split layer supplies current shares); settlements holds
// recorded payments, each counted exactly once. Results sort by
// participant ID. Settlements naming a participant absent from owed are
// kept with zero owed so history survives share revisions; a negative
// owed share is a caller error.
func SummarizeSettlements(owed map[string]int64, settlements []Settlement) ([]ParticipantSettlement, error) {
	for participant, amount := range owed {
		if amount < 0 {
			return nil, fmt.Errorf("%w: owed share for %s must not be negative", ErrGroupInvalid, participant)
		}
	}
	settled := make(map[string]int64, len(owed))
	for _, record := range settlements {
		settled[record.ParticipantID] += record.AmountMinor
	}
	participants := make([]string, 0, len(owed))
	for participant := range owed {
		participants = append(participants, participant)
	}
	for participant := range settled {
		if _, known := owed[participant]; !known {
			participants = append(participants, participant)
		}
	}
	sort.Strings(participants)
	summary := make([]ParticipantSettlement, 0, len(participants))
	for _, participant := range participants {
		owedMinor := owed[participant]
		settledMinor := settled[participant]
		outstanding := owedMinor - settledMinor
		if outstanding < 0 {
			outstanding = 0
		}
		state := SettlementStateOutstanding
		switch {
		case settledMinor >= owedMinor:
			state = SettlementStateSettled
		case settledMinor > 0:
			state = SettlementStatePartiallySettled
		}
		summary = append(summary, ParticipantSettlement{
			ParticipantID:    participant,
			OwedMinor:        owedMinor,
			SettledMinor:     settledMinor,
			OutstandingMinor: outstanding,
			State:            state,
		})
	}
	return summary, nil
}

// SplitSettlementState rolls per-participant positions into one split
// state: settled when every share is settled (vacuously true with no
// participants), partially-settled when anything was recorded short of
// full coverage, outstanding otherwise.
func SplitSettlementState(summary []ParticipantSettlement) string {
	settled := true
	recorded := false
	for _, position := range summary {
		if position.State != SettlementStateSettled {
			settled = false
		}
		if position.SettledMinor > 0 {
			recorded = true
		}
	}
	switch {
	case settled:
		return SettlementStateSettled
	case recorded:
		return SettlementStatePartiallySettled
	default:
		return SettlementStateOutstanding
	}
}
