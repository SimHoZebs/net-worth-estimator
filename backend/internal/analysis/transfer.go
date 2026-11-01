package analysis

import (
	"context"
	"math"
	"sort"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const TransferVersion = "transfer-v1"

// transferMatchWindowDays bounds how far apart opposite legs may post.
//
// Decided product rule (see VIS-03): both sides of a transfer between owned
// accounts are logged as one movement, but the two records do not arrive in
// sync, so legs can be days apart. Change this constant only with a new
// product decision.
const transferMatchWindowDays = 7

type Transfer struct{}

func (Transfer) Type() string    { return "transfer" }
func (Transfer) Version() string { return TransferVersion }

type transferLeg struct {
	transaction types.AnalysisTransaction
	cents       int64
	day         int64
}

func transferStamp(facts types.TransactionFacts) int64 {
	if facts.OccurredAt > 0 {
		return facts.OccurredAt
	}
	return facts.PostedTime
}

// Analyze pairs opposite legs of one internal money movement. It only
// annotates observed transactions: an unmatched leg emits nothing, and no
// missing leg is ever fabricated. A leg with exactly one mutual candidate is
// a strong match; a leg with several candidates stays visible for review at
// moderate strength with every candidate listed in its evidence.
func (Transfer) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	var outflows, inflows []transferLeg
	for _, transaction := range input.Transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if transaction.Pending || transaction.Void || transaction.Facts.Currency != "USD" {
			continue
		}
		amount, err := strconv.ParseFloat(transaction.Facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || math.Abs(amount) > 1e10 || amount == 0 {
			continue
		}
		stamp := transferStamp(transaction.Facts)
		if stamp <= 0 {
			continue
		}
		leg := transferLeg{transaction: transaction, cents: int64(math.Round(math.Abs(amount) * 100)), day: stamp / 86400}
		if leg.cents == 0 {
			continue
		}
		if amount < 0 {
			outflows = append(outflows, leg)
		} else {
			inflows = append(inflows, leg)
		}
	}
	matches := func(outflow, inflow transferLeg) bool {
		if outflow.transaction.AccountID == inflow.transaction.AccountID {
			return false
		} // Legs on one account are corrections or refunds, not transfers.
		if outflow.cents != inflow.cents {
			return false
		} // Decided product rule: exact to the cent. Near-matches from fees
		// or currency conversion stay unmatched by decision, not omission.
		gap := outflow.day - inflow.day
		return gap >= -transferMatchWindowDays && gap <= transferMatchWindowDays
	}
	outflowCandidates := make([][]int, len(outflows))
	inflowCandidates := make([][]int, len(inflows))
	for o, outflow := range outflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for i, inflow := range inflows {
			if matches(outflow, inflow) {
				outflowCandidates[o] = append(outflowCandidates[o], i)
				inflowCandidates[i] = append(inflowCandidates[i], o)
			}
		}
	}
	role := func(negative bool) string {
		if negative {
			return "outflow"
		}
		return "inflow"
	}
	detection := func(leg transferLeg, negative bool, strength string, partnerIDs []string) types.AnalysisDetection {
		ids := append([]string{leg.transaction.PostingID}, partnerIDs...)
		sort.Strings(ids[1:])
		code := "transfer.exact-leg-match"
		reason := "An opposite-direction transaction for the exact amount posts on another account within the transfer window. Both legs are observed; neither is fabricated."
		if strength == "moderate" {
			code = "transfer.ambiguous-legs"
			reason = "Several opposite-direction transactions match this amount and date. Review selects the true opposite leg; unmatched candidates stay visible."
		}
		return types.AnalysisDetection{
			PostingID: leg.transaction.PostingID,
			Kind:      "transfer",
			Provider:  leg.transaction.SourceProvider,
			Product:   "internal-transfer",
			Role:      role(negative),
			Strength:  strength,
			Evidence:  []types.AnalysisEvidence{{Code: code, Reason: reason, PostingIDs: ids}},
		}
	}
	pairedOutflow := make([]bool, len(outflows))
	pairedInflow := make([]bool, len(inflows))
	findings := []types.AnalysisDetection{}
	for o, outflow := range outflows {
		if len(outflowCandidates[o]) != 1 {
			continue
		}
		i := outflowCandidates[o][0]
		if len(inflowCandidates[i]) != 1 || inflowCandidates[i][0] != o {
			continue
		} // The partner also matches elsewhere: both legs need review below.
		pairedOutflow[o], pairedInflow[i] = true, true
		findings = append(findings, detection(outflow, true, "strong", []string{inflows[i].transaction.PostingID}))
		findings = append(findings, detection(inflows[i], false, "strong", []string{outflow.transaction.PostingID}))
	}
	for o, outflow := range outflows {
		if pairedOutflow[o] || len(outflowCandidates[o]) == 0 {
			continue
		}
		partners := make([]string, 0, len(outflowCandidates[o]))
		for _, i := range outflowCandidates[o] {
			partners = append(partners, inflows[i].transaction.PostingID)
		}
		findings = append(findings, detection(outflow, true, "moderate", partners))
	}
	for i, inflow := range inflows {
		if pairedInflow[i] || len(inflowCandidates[i]) == 0 {
			continue
		}
		partners := make([]string, 0, len(inflowCandidates[i]))
		for _, o := range inflowCandidates[i] {
			partners = append(partners, outflows[o].transaction.PostingID)
		}
		findings = append(findings, detection(inflow, false, "moderate", partners))
	}
	sort.Slice(findings, func(a, b int) bool { return findings[a].PostingID < findings[b].PostingID })
	return findings, nil
}
