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

// Bank reference values are observations, not payment-stream identities.
var paymentReferenceSuffix = regexp.MustCompile(`(?i)\b(?:(?:ppd|ccd)\s+)?(?:id|ref(?:erence)?|trace)\s*[:#].*$`)
var paymentReferenceToken = regexp.MustCompile(`(?i)^[a-z]{0,4}[0-9x]{4,}$`)

func paymentStreamText(text string) string {
	text = paymentReferenceSuffix.ReplaceAllString(text, "")
	cleaned := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return ' '
	}, strings.ToLower(text))
	var tokens []string
	for _, token := range strings.Fields(cleaned) {
		if token == "dept" || paymentReferenceToken.MatchString(token) {
			continue
		}
		tokens = append(tokens, token)
	}
	return strings.Join(tokens, " ")
}

type paymentGroup struct {
	key        string
	merchant   string
	direction  string
	candidates []paymentOccurrence
}

func paymentGroups(ctx context.Context, transactions []types.AnalysisTransaction, transfers map[string]bool) ([]paymentGroup, error) {
	groups := map[string]*paymentGroup{}
	for _, tx := range transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if tx.Pending || tx.Void || transfers[tx.TransactionID] {
			continue
		}
		facts := tx.Facts
		text := strings.Join([]string{facts.Description, facts.Payee, facts.Memo, facts.Metadata["merchant_name"]}, " ")
		if paymentRefundMarker.MatchString(text) {
			continue
		}
		description := paymentStreamText(facts.Description)
		payee := paymentStreamText(facts.Payee)
		merchantName := paymentStreamText(facts.Metadata["merchant_name"])
		// When a bank supplies its description only as a memo, preserve that
		// descriptive identity rather than grouping every memo-only deposit.
		if description == "" && payee == "" && merchantName == "" {
			description = paymentStreamText(facts.Memo)
		}
		merchant := recurringKey(strings.Join([]string{description, payee, merchantName}, " "))
		if merchant == "" {
			continue
		}
		amount, err := strconv.ParseFloat(facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount == 0 || math.Abs(amount) > 1e10 {
			continue
		}
		stamp := paymentStamp(facts)
		if stamp <= 0 {
			continue
		}
		// Preserve descriptive properties before amount filtering. A display
		// merchant like "amazon" must not merge payroll with other payments.
		memo := paymentStreamText(facts.Memo)
		category := strings.ToLower(strings.TrimSpace(facts.Metadata["category"]))
		if normalized, ok := types.BankCategory(facts.Metadata["category"]); ok {
			category = normalized
		}
		direction := "inflow"
		if amount < 0 {
			direction = "outflow"
		}
		key := strings.Join([]string{
			tx.SourceProvider, tx.AccountID, facts.Currency,
			description, payee, merchantName, memo, category, direction,
		}, "\x00")
		group := groups[key]
		if group == nil {
			group = &paymentGroup{key: key, merchant: merchant, direction: direction}
			groups[key] = group
		}
		group.candidates = append(group.candidates, paymentOccurrence{tx, amount, stamp / 86400, text})
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]paymentGroup, 0, len(keys))
	for _, key := range keys {
		result = append(result, *groups[key])
	}
	return result, nil
}
