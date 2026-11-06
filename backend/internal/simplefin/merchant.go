package simplefin

import (
	"strings"
	"unicode"
)

// merchantPrefixes wrap the merchant in a card descriptor. They carry the
// processor, not the merchant, so the join drops them before comparing.
var merchantPrefixes = map[string]bool{
	"CLOVER":  true,
	"DD":      true,
	"IC":      true,
	"PAYPAL":  true,
	"PP":      true,
	"SHOPIFY": true,
	"SP":      true,
	"SQ":      true,
	"SQUARE":  true,
	"STRIPE":  true,
	"TOAST":   true,
	"TST":     true,
}

// merchantTokenAliases expand common bank abbreviations so one descriptor
// can meet another from the same merchant.
var merchantTokenAliases = map[string]string{
	"AMZN":     "AMAZON",
	"MKTP":     "MARKETPLACE",
	"MKTPL":    "MARKETPLACE",
	"MKTPLACE": "MARKETPLACE",
}

// merchantNoise carries bank lifecycle or card-network meaning instead of
// merchant identity. A hold descriptor adds these around the merchant name;
// a posted descriptor usually drops them.
var merchantNoise = map[string]bool{
	"ACH":           true,
	"AMEX":          true,
	"AUTH":          true,
	"AUTHORIZATION": true,
	"AUTHORIZED":    true,
	"CARD":          true,
	"CHECKCARD":     true,
	"CREDIT":        true,
	"DEBIT":         true,
	"DISCOVER":      true,
	"HOLD":          true,
	"MASTERCARD":    true,
	"ONLINE":        true,
	"PAYMENT":       true,
	"PENDING":       true,
	"PMT":           true,
	"POS":           true,
	"PRE":           true,
	"PREAUTH":       true,
	"PURCHASE":      true,
	"RECURRENCE":    true,
	"RECURRING":     true,
	"TEMP":          true,
	"TEMPORARY":     true,
	"VISA":          true,
	"WEB":           true,
}

// merchantKey reduces a bank descriptor to at most two leading tokens that
// identify the merchant. Tokens with digits are store numbers, dates, or
// references, never merchant identity.
func merchantKey(name string) []string {
	tokens := strings.FieldsFunc(strings.ToUpper(name), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	for len(tokens) > 0 && merchantPrefixes[tokens[0]] {
		tokens = tokens[1:]
	}
	key := tokens[:0]
	for _, token := range tokens {
		if merchantNoise[token] {
			continue
		}
		if strings.IndexFunc(token, unicode.IsDigit) >= 0 {
			continue
		}
		if alias, ok := merchantTokenAliases[token]; ok {
			token = alias
		}
		key = append(key, token)
		if len(key) == 2 {
			break
		}
	}
	return key
}

func namesContainNormalized(left, right string) bool {
	return strings.Contains(left, right) || strings.Contains(right, left)
}

// merchantNamesContain is the strict containment rule. Settled-to-settled
// deduplication keeps it: a descriptor change can be a genuine second
// charge, so only a name that contains the other may suppress.
func merchantNamesContain(a, b string) bool {
	left := strings.ToUpper(strings.TrimSpace(a))
	right := strings.ToUpper(strings.TrimSpace(b))
	return left != "" && right != "" && namesContainNormalized(left, right)
}

// merchantNamesMatch reports whether two bank descriptors name the same
// merchant. Exact containment covers unchanged descriptors. The merchant key
// covers descriptors that change between authorization and transaction, such as
// "LYFT *TEMP AUTH HOLD" and "LYFT *STANDARD": both reduce to LYFT after the
// hold noise is removed. A longer key must agree on every token the shorter
// key carries, so "BISTRO UPTOWN" never joins "BISTRO DOWNTOWN".
func merchantNamesMatch(a, b string) bool {
	left := strings.ToUpper(strings.TrimSpace(a))
	right := strings.ToUpper(strings.TrimSpace(b))
	if left == "" || right == "" {
		return false
	}
	if namesContainNormalized(left, right) {
		return true
	}
	leftKey := merchantKey(left)
	rightKey := merchantKey(right)
	if len(leftKey) == 0 || len(rightKey) == 0 {
		return false
	}
	shared := len(leftKey)
	if len(rightKey) < shared {
		shared = len(rightKey)
	}
	for i := 0; i < shared; i++ {
		if leftKey[i] != rightKey[i] {
			return false
		}
	}
	return true
}
