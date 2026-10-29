package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

// readOnlyMiddleware rejects canonical model writes and the SimpleFIN sync
// trigger with 403. The outer identity boundary owns authentication and plan
// permissions. Reads and compute endpoints pass through this kill switch.
// New write routes must add a prefix here: the guard is a string table,
// not derived from route registration, so an unlisted route stays open.
func readOnlyMiddleware(readOnly bool) func(http.Handler) http.Handler {
	guardedPrefixes := []string{
		http.MethodPost + " /v1/receipts",
		http.MethodPut + " /v1/receipts/",
		http.MethodPatch + " /v1/receipts/",
		http.MethodDelete + " /v1/receipts/",
		http.MethodPut + " /v1/safe-spending-settings",
		http.MethodPost + " /v1/accounts",
		http.MethodPatch + " /v1/accounts/",
		http.MethodDelete + " /v1/accounts/",
		http.MethodPost + " /v1/postings",
		http.MethodPatch + " /v1/postings/",
		http.MethodDelete + " /v1/postings/",
		http.MethodPost + " /v1/transactions/",
		http.MethodPost + " /v1/recurrence-rules",
		http.MethodPatch + " /v1/recurrence-rules/",
		http.MethodDelete + " /v1/recurrence-rules/",
		http.MethodPost + " /v1/checkpoints",
		http.MethodDelete + " /v1/checkpoints",
		http.MethodPost + " /v1/evaluations",
		http.MethodPatch + " /v1/evaluations/",
		http.MethodDelete + " /v1/evaluations/",
		http.MethodPost + " /v1/amount-presets",
		http.MethodPatch + " /v1/amount-presets/",
		http.MethodDelete + " /v1/amount-presets/",
		http.MethodPut + " /v1/pinned-evaluations",
		http.MethodPost + " /v1/payment-terms",
		http.MethodDelete + " /v1/payment-terms/",
		http.MethodPost + " /v1/sync/simplefin",
		http.MethodPost + " /v1/sync/simplefin/credential",
		http.MethodDelete + " /v1/sync/simplefin/credential",
		http.MethodPut + " /v1/sync/simplefin/cards",
		http.MethodPut + " /v1/sync/simplefin/accounts/",
		http.MethodDelete + " /v1/sync/simplefin/accounts/",
	}
	isGuarded := func(method, requestPath string) bool {
		key := method + " " + requestPath
		for _, prefix := range guardedPrefixes {
			if key == prefix || strings.HasPrefix(key, prefix) {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isGuarded(r.Method, r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			if readOnly {
				writeAPIError(w, http.StatusForbidden, "Forbidden", "server is read-only")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeAPIError mirrors the huma error envelope so middleware rejections
// look like handler rejections.
func writeAPIError(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"title":  title,
		"status": status,
		"detail": detail,
	})
}
