package simplefin

import (
	"math"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SettleCandidate is one settled bank row that could be the posted version
// of a void hold, with the evidence used to rank it.
type SettleCandidate struct {
	Transaction       types.Transaction
	Cents             int64
	DayGapDays        int
	AmountDeltaCents  int64
	DescriptorChanged bool
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

// settleCandidate scores one candidate against a void hold. It uses the
// same widened merchant key and merchant profile as the pending-to-posted
// convert.
func settleCandidate(voidRow types.Transaction, candidate types.Transaction) (SettleCandidate, bool) {
	profile := profileForTransaction(voidRow)
	staleCents, candidateCents, ok := settleJoinKeysWith(
		voidRow, candidate, profile.windowSeconds(), merchantNamesMatch,
	)
	if !ok {
		return SettleCandidate{}, false
	}
	if !profile.allowsAmount(staleCents, candidateCents) {
		return SettleCandidate{}, false
	}
	gap := candidate.TransactionTime - voidRow.TransactionTime
	return SettleCandidate{
		Transaction:       candidate,
		Cents:             candidateCents,
		DayGapDays:        int(math.Round(math.Abs(float64(gap)) / 86400)),
		AmountDeltaCents:  candidateCents - staleCents,
		DescriptorChanged: !merchantNamesContain(voidRow.Name, candidate.Name),
	}, true
}

// SettleCandidates returns settled bank rows that could be the posted
// version of a void hold. The result is ordered by date closeness, then
// amount closeness, so the first row is the suggested posted charge. The
// caller still decides whether the pair is unique enough to convert.
func SettleCandidates(hold store.BankRow, bank []store.BankRow) []SettleCandidate {
	voidRow := hold.Transaction
	if voidRow.Source != store.SourceBankSync || !voidRow.Void || voidRow.Pending || !hasSimpleFINKey(hold) {
		return nil
	}
	if cents, ok := transactionAmountCents(voidRow); !ok || cents <= 0 {
		return nil
	}
	candidates := make([]SettleCandidate, 0)
	for _, row := range bank {
		candidate := row.Transaction
		if candidate.ID == voidRow.ID {
			continue
		}
		if candidate.Source != store.SourceBankSync || candidate.Pending || candidate.Void || !hasSimpleFINKey(row) {
			continue
		}
		scored, ok := settleCandidate(voidRow, candidate)
		if !ok {
			continue
		}
		candidates = append(candidates, scored)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].DayGapDays != candidates[j].DayGapDays {
			return candidates[i].DayGapDays < candidates[j].DayGapDays
		}
		leftDelta := absInt64(candidates[i].AmountDeltaCents)
		rightDelta := absInt64(candidates[j].AmountDeltaCents)
		if leftDelta != rightDelta {
			return leftDelta < rightDelta
		}
		return candidates[i].Transaction.ID < candidates[j].Transaction.ID
	})
	return candidates
}

// SettleCandidateDate returns the display day for a candidate. Settled bank
// rows normalize their transaction time to the posted instant, so the first
// nonzero stamp is the day the owner sees in the activity list.
func SettleCandidateDate(candidate SettleCandidate) string {
	stamp := candidate.Transaction.TransactionTime
	if stamp <= 0 {
		stamp = candidate.Transaction.PostedTime
	}
	if stamp <= 0 {
		return ""
	}
	return time.Unix(stamp, 0).UTC().Format("2006-01-02")
}
