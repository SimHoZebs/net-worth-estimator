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

const BNPLVersion = "bnpl-v1"

type BNPL struct{}

func (BNPL) Type() string    { return "bnpl" }
func (BNPL) Version() string { return BNPLVersion }

type providerRule struct {
	id               string
	pattern          *regexp.Regexp
	patternCandidate bool
}

// These recognize identities, not financing. A provider name alone never emits
// a finding. New providers add catalog entries rather than classifier branches.
var bnplProviders = []providerRule{
	{"klarna", regexp.MustCompile(`(?i)\bklarna\b`), true},
	{"affirm", regexp.MustCompile(`(?i)\baffirm\b`), true},
	{"afterpay", regexp.MustCompile(`(?i)\bafterpay\b`), true},
	{"sezzle", regexp.MustCompile(`(?i)\bsezzle\b`), true},
	{"zip", regexp.MustCompile(`(?i)\bzip(?:pay|money)?\b`), true},
	{"paypal", regexp.MustCompile(`(?i)\bpaypal\b`), false},
	{"shop-pay", regexp.MustCompile(`(?i)\bshop\s+pay\b`), false},
}

var bnplProducts = []struct {
	id      string
	pattern *regexp.Regexp
}{
	{"pay-in-four", regexp.MustCompile(`(?i)\bpay\s*(?:in\s*)?(?:4|four)\b`)},
	{"deferred-invoice", regexp.MustCompile(`(?i)\bpay\s+in\s+30\s+days\b`)},
	{"installments", regexp.MustCompile(`(?i)\b(?:instal[l]?ments?|pay\s+monthly|pay\s+over\s+time)\b`)},
	{"deferred-payment", regexp.MustCompile(`(?i)\b(?:bnpl|buy\s+now\s+pay\s+later|pay\s+later)\b`)},
}

var immediatePayment = regexp.MustCompile(`(?i)\b(?:pay\s+now|pay\s+in\s+full\s+today)\b`)
var refundMarker = regexp.MustCompile(`(?i)\b(?:refund|reversal|return)\b`)

type bnplCandidate struct {
	transaction types.AnalysisTransaction
	provider    providerRule
	amount      int64
	day         int64
}

func (BNPL) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	findings := []types.AnalysisDetection{}
	groups := map[string][]bnplCandidate{}
	for _, transaction := range input.Transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if transaction.Pending || transaction.Void || transaction.Facts.Currency != "USD" {
			continue
		}
		facts := transaction.Facts
		text := strings.Join([]string{facts.Description, facts.Payee, facts.Memo, facts.Metadata["merchant_name"], facts.Metadata["payment_product"]}, " ")
		text = strings.NewReplacer("-", " ", "_", " ").Replace(text)
		if immediatePayment.MatchString(text) {
			continue
		}
		provider, matches := providerRule{}, 0
		for _, rule := range bnplProviders {
			if rule.pattern.MatchString(text) {
				provider, matches = rule, matches+1
			}
		}
		if matches > 1 {
			continue
		} // Conflicting identities require review, not a first-match verdict.
		product := ""
		if matches == 1 {
			for _, rule := range bnplProducts {
				if rule.pattern.MatchString(text) {
					product = rule.id
					break
				}
			}
		}
		sourceCategory := facts.Metadata["category"] == "LOAN_PAYMENTS_BNPL"
		amount, err := strconv.ParseFloat(facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || math.Abs(amount) > 1e10 || amount == 0 {
			continue
		}
		if sourceCategory || product != "" {
			role := "unknown"
			if amount < 0 {
				role = "repayment"
			} else if refundMarker.MatchString(text) {
				role = "refund"
			}
			evidence := types.AnalysisEvidence{Code: "bnpl.product-descriptor", Reason: "A recognized provider and an explicit deferred-payment or installment descriptor occur in the source evidence.", PostingIDs: []string{transaction.PostingID}}
			if sourceCategory {
				evidence.Code, evidence.Reason = "bnpl.source-category", "The source supplies the explicit LOAN_PAYMENTS_BNPL category."
			}
			findings = append(findings, types.AnalysisDetection{PostingID: transaction.PostingID, Kind: "bnpl", Provider: provider.id, Product: product, Role: role, Strength: "strong", Evidence: []types.AnalysisEvidence{evidence}})
			continue
		}
		// Generic PayPal and Shop Pay recurrence is not evidence of financing.
		if matches != 1 || !provider.patternCandidate || amount >= 0 {
			continue
		}
		stamp := facts.OccurredAt
		if stamp <= 0 {
			stamp = facts.PostedTime
		}
		if stamp <= 0 {
			continue
		}
		cents := int64(math.Round(amount * 100))
		key := transaction.SourceProvider + "\x00" + transaction.AccountID + "\x00" + provider.id + "\x00" + strconv.FormatInt(cents, 10)
		groups[key] = append(groups[key], bnplCandidate{transaction, provider, cents, stamp / 86400})
	}
	// A short, approximately fortnightly series is supporting evidence only.
	// A bounded group avoids an all-pairs search or a speculative plan matcher.
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(group) < 3 || len(group) > 4 {
			continue
		}
		sort.Slice(group, func(i, j int) bool { return group[i].day < group[j].day })
		ids, regular := []string{}, true
		for i, item := range group {
			ids = append(ids, item.transaction.PostingID)
			if i > 0 {
				gap := item.day - group[i-1].day
				regular = regular && gap >= 12 && gap <= 16
			}
		}
		if !regular {
			continue
		}
		for _, item := range group {
			findings = append(findings, types.AnalysisDetection{PostingID: item.transaction.PostingID, Kind: "bnpl", Provider: item.provider.id, Product: "unknown", Role: "repayment", Strength: "moderate", Evidence: []types.AnalysisEvidence{{Code: "bnpl.fortnightly-candidate", Reason: "A recognized financing provider has three or four equal withdrawals approximately two weeks apart. This pattern suggests BNPL but does not establish a payment plan.", PostingIDs: ids}}})
		}
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].PostingID < findings[j].PostingID })
	return findings, nil
}
