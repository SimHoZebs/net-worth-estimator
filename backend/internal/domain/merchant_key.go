package domain

import "strings"

// NormalizedMerchantKey reduces a descriptor to a stable merchant fingerprint:
// the first lowercase alphanumeric token of at least three characters that is
// not entirely digits. An empty result means the text carries no identity.
// This is the same algorithm the analysis normalizer uses so a promotion
// record and a bank descriptor produce comparable keys.
func NormalizedMerchantKey(text string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return ' '
	}, strings.ToLower(text))
	for _, token := range strings.Fields(cleaned) {
		if len(token) < 3 {
			continue
		}
		digits := true
		for _, r := range token {
			if r < '0' || r > '9' {
				digits = false
				break
			}
		}
		if !digits {
			return token
		}
	}
	return ""
}
