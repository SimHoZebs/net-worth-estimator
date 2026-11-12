package analysis

import (
	"context"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const TransferVersion = "transfer-v2"

// transferMatchWindowDays bounds how far apart opposite legs may post.
//
// Decided product rule (see VIS-03): both sides of a transfer between owned
// accounts are logged as one movement, but the two records do not arrive in
// sync, so legs can be days apart. Change this constant only with a new
// product decision.
const transferMatchWindowDays = 7

// transferStrongThreshold is the minimum edge score for a greedily matched
// pair to count as a clear winner. A unique close pair (time 7 + order 1 +
// rarity 4) already exceeds it, while round amounts with many lookalikes sit
// near it but fail the clear-winner test because their rivals tie them.
const transferStrongThreshold = 5

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

// transferEdge is one scored outflow-to-inflow candidate pair. Scores are
// small integers from deterministic local signals only: no models, no
// probabilities, no external data.
type transferEdge struct {
	outflow int
	inflow  int
	score   int
}

var (
	transferTailDigits = regexp.MustCompile(`[0-9]{4,}`)
	transferTokenSplit = regexp.MustCompile(`[^a-z0-9]+`)
)

var transferKeywords = []string{"transfer", "xfer", "internal", "online banking transfer", "ach transfer", "wire transfer"}

var transferPayoffSides = []string{"credit card payment", "card payment", "payoff"}

var transferPayoffThanks = []string{"payment received", "payment thank", "autopay"}

var transferExclusionMarkers = []string{"refund", "reversal", "reversed", "chargeback", "returned", "return", "dispute"}

// transferCommonTokens are generic banking words that never count as shared
// reference tokens on their own.
var transferCommonTokens = map[string]bool{
	"transfer": true, "payment": true, "payments": true, "amount": true,
	"amounts": true, "date": true, "dates": true, "banking": true,
	"online": true, "internal": true, "account": true, "accounts": true,
	"credit": true, "debit": true, "checking": true, "savings": true,
	"received": true, "thank": true, "payoff": true, "autopay": true,
}

func transferContainsAny(text string, phrases []string) bool {
	for _, phrase := range phrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

// transferText combines the descriptive bank evidence for one leg.
func transferText(leg transferLeg) string {
	return strings.ToLower(leg.transaction.Facts.Description + " " + leg.transaction.Facts.Payee + " " + leg.transaction.Facts.Memo)
}

// transferTails returns the trailing 4 digits of every long digit run, so
// masked tails like xx1234 match full account numbers ending in 1234.
func transferTails(text string) map[string]bool {
	tails := map[string]bool{}
	for _, run := range transferTailDigits.FindAllString(text, -1) {
		tails[run[len(run)-4:]] = true
	}
	return tails
}

func transferShareTail(a, b string) bool {
	ours := transferTails(a)
	if len(ours) == 0 {
		return false
	}
	for tail := range transferTails(b) {
		if ours[tail] {
			return true
		}
	}
	return false
}

// transferTokens returns distinctive lowercase tokens of at least 6
// alphanumerics, so shared reference numbers match across legs.
func transferTokens(text string) map[string]bool {
	tokens := map[string]bool{}
	for _, token := range transferTokenSplit.Split(text, -1) {
		if len(token) >= 6 && !transferCommonTokens[token] {
			tokens[token] = true
		}
	}
	return tokens
}

func transferShareToken(a, b string) bool {
	ours := transferTokens(a)
	if len(ours) == 0 {
		return false
	}
	for token := range transferTokens(b) {
		if ours[token] {
			return true
		}
	}
	return false
}

// transferScore ranks one surviving outflow/inflow pair. Higher is stronger.
// Closer dates score higher, outflow-first order earns a small bonus, unique
// amounts outrank round duplicates, transfer wording and shared account tails
// or reference tokens add confidence, card-payoff symmetry adds a little,
// same-provider legs score slightly stronger, and refund/reversal markers
// apply a heavy penalty so tainted pairs lose to clean ones.
func transferScore(outflow, inflow transferLeg, frequency int, outflowText, inflowText string) int {
	gap := outflow.day - inflow.day
	if gap < 0 {
		gap = -gap
	}
	score := int(transferMatchWindowDays - gap)
	if outflow.day <= inflow.day {
		score++
	}
	switch frequency {
	case 2:
		score += 4
	case 3:
		score += 2
	case 4:
		score += 1
	}
	outflowKeyword := transferContainsAny(outflowText, transferKeywords)
	inflowKeyword := transferContainsAny(inflowText, transferKeywords)
	if outflowKeyword || inflowKeyword {
		score += 2
	}
	if outflowKeyword && inflowKeyword {
		score += 2
	}
	if transferShareTail(outflowText, inflowText) || transferShareToken(outflowText, inflowText) {
		score += 2
	}
	if (transferContainsAny(outflowText, transferPayoffSides) && transferContainsAny(inflowText, transferPayoffThanks)) ||
		(transferContainsAny(inflowText, transferPayoffSides) && transferContainsAny(outflowText, transferPayoffThanks)) {
		score++
	}
	if outflow.transaction.SourceProvider != "" && outflow.transaction.SourceProvider == inflow.transaction.SourceProvider {
		score++
	}
	if transferContainsAny(outflowText+" "+inflowText, transferExclusionMarkers) {
		score -= 10
	}
	return score
}

// Analyze pairs opposite legs of one internal money movement. It only
// annotates observed transactions: an unmatched leg emits nothing, and no
// missing leg is ever fabricated. Surviving candidates score on date
// proximity, order, amount rarity, descriptive signals, and provider
// continuity; a greedy pass claims the highest-scoring pairs first so one
// leg never matches twice. A matched pair with no rival at all, or a clear
// scoring winner, is a strong match; every other leg with candidates stays
// visible for review at moderate strength with all candidates ranked
// best-first in its evidence.
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
	frequency := map[int64]int{}
	for _, outflow := range outflows {
		frequency[outflow.cents]++
	}
	for _, inflow := range inflows {
		frequency[inflow.cents]++
	}
	outflowTexts := make([]string, len(outflows))
	for o, outflow := range outflows {
		outflowTexts[o] = transferText(outflow)
	}
	inflowTexts := make([]string, len(inflows))
	for i, inflow := range inflows {
		inflowTexts[i] = transferText(inflow)
	}
	edgeScore := map[[2]int]int{}
	var edges []transferEdge
	outflowCandidates := make([][]int, len(outflows))
	inflowCandidates := make([][]int, len(inflows))
	for o, outflow := range outflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for i, inflow := range inflows {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if !matches(outflow, inflow) {
				continue
			}
			score := transferScore(outflow, inflow, frequency[outflow.cents], outflowTexts[o], inflowTexts[i])
			edgeScore[[2]int{o, i}] = score
			edges = append(edges, transferEdge{outflow: o, inflow: i, score: score})
			outflowCandidates[o] = append(outflowCandidates[o], i)
			inflowCandidates[i] = append(inflowCandidates[i], o)
		}
	}
	sort.Slice(edges, func(a, b int) bool {
		if edges[a].score != edges[b].score {
			return edges[a].score > edges[b].score
		}
		outA := outflows[edges[a].outflow].transaction.TransactionID
		outB := outflows[edges[b].outflow].transaction.TransactionID
		if outA != outB {
			return outA < outB
		}
		return inflows[edges[a].inflow].transaction.TransactionID < inflows[edges[b].inflow].transaction.TransactionID
	})
	matchedInflow := make([]int, len(outflows))
	for o := range matchedInflow {
		matchedInflow[o] = -1
	}
	matchedOutflow := make([]int, len(inflows))
	for i := range matchedOutflow {
		matchedOutflow[i] = -1
	}
	for _, edge := range edges {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if matchedInflow[edge.outflow] >= 0 || matchedOutflow[edge.inflow] >= 0 {
			continue
		}
		matchedInflow[edge.outflow] = edge.inflow
		matchedOutflow[edge.inflow] = edge.outflow
	}
	clearWinner := func(o, i, score int) bool {
		if score < transferStrongThreshold {
			return false
		}
		for _, rival := range outflowCandidates[o] {
			if rival == i {
				continue
			}
			if gap := edgeScore[[2]int{o, rival}] - score; gap >= -1 && gap <= 1 {
				return false
			}
		}
		for _, rival := range inflowCandidates[i] {
			if rival == o {
				continue
			}
			if gap := edgeScore[[2]int{rival, i}] - score; gap >= -1 && gap <= 1 {
				return false
			}
		}
		return true
	}
	role := func(negative bool) string {
		if negative {
			return "outflow"
		}
		return "inflow"
	}
	detection := func(leg transferLeg, negative bool, strength string, partnerIDs []string) types.AnalysisDetection {
		ids := append([]string{leg.transaction.TransactionID}, partnerIDs...)
		code := "transfer.exact-leg-match"
		reason := "An opposite-direction transaction for the exact amount posts on another account within the transfer window. Date proximity, amount rarity, descriptive signals, and provider continuity select this leg. Both legs are observed; neither is fabricated."
		if strength == "moderate" {
			code = "transfer.ambiguous-legs"
			reason = "Several opposite-direction transactions match this amount and date. Candidates rank best-first by date proximity, amount rarity, descriptive signals, and provider continuity. Review selects the true opposite leg; unmatched candidates stay visible."
		}
		return types.AnalysisDetection{
			TransactionID: leg.transaction.TransactionID,
			Kind:          "transfer",
			Provider:      leg.transaction.SourceProvider,
			Product:       "internal-transfer",
			Role:          role(negative),
			Strength:      strength,
			Evidence:      []types.AnalysisEvidence{{Code: code, Reason: reason, TransactionIDs: ids}},
		}
	}
	rankedInflows := func(o int) []string {
		candidates := append([]int(nil), outflowCandidates[o]...)
		sort.Slice(candidates, func(a, b int) bool {
			scoreA := edgeScore[[2]int{o, candidates[a]}]
			scoreB := edgeScore[[2]int{o, candidates[b]}]
			if scoreA != scoreB {
				return scoreA > scoreB
			}
			return inflows[candidates[a]].transaction.TransactionID < inflows[candidates[b]].transaction.TransactionID
		})
		partners := make([]string, 0, len(candidates))
		for _, i := range candidates {
			partners = append(partners, inflows[i].transaction.TransactionID)
		}
		return partners
	}
	rankedOutflows := func(i int) []string {
		candidates := append([]int(nil), inflowCandidates[i]...)
		sort.Slice(candidates, func(a, b int) bool {
			scoreA := edgeScore[[2]int{candidates[a], i}]
			scoreB := edgeScore[[2]int{candidates[b], i}]
			if scoreA != scoreB {
				return scoreA > scoreB
			}
			return outflows[candidates[a]].transaction.TransactionID < outflows[candidates[b]].transaction.TransactionID
		})
		partners := make([]string, 0, len(candidates))
		for _, o := range candidates {
			partners = append(partners, outflows[o].transaction.TransactionID)
		}
		return partners
	}
	strongOutflow := make([]bool, len(outflows))
	strongInflow := make([]bool, len(inflows))
	findings := []types.AnalysisDetection{}
	for o, outflow := range outflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		i := matchedInflow[o]
		if i < 0 {
			continue
		}
		if (len(outflowCandidates[o]) == 1 && len(inflowCandidates[i]) == 1) || clearWinner(o, i, edgeScore[[2]int{o, i}]) {
			strongOutflow[o], strongInflow[i] = true, true
			findings = append(findings, detection(outflow, true, "strong", []string{inflows[i].transaction.TransactionID}))
			findings = append(findings, detection(inflows[i], false, "strong", []string{outflow.transaction.TransactionID}))
		}
	}
	for o, outflow := range outflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if strongOutflow[o] || len(outflowCandidates[o]) == 0 {
			continue
		}
		findings = append(findings, detection(outflow, true, "moderate", rankedInflows(o)))
	}
	for i, inflow := range inflows {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if strongInflow[i] || len(inflowCandidates[i]) == 0 {
			continue
		}
		findings = append(findings, detection(inflow, false, "moderate", rankedOutflows(i)))
	}
	sort.Slice(findings, func(a, b int) bool { return findings[a].TransactionID < findings[b].TransactionID })
	return findings, nil
}
