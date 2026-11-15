package main

import (
	"encoding/json"
	"io"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const cashObservationsPath = "/__fixture/cash-observations"

type cashObservationStore interface {
	LoadModel() (*types.FinancialModel, error)
	ApplySync([]store.SyncCheckpoint, []store.BankDirective) (store.SyncApplySummary, error)
}

// cashObservationsHandler seeds bank evidence only in this disposable harness.
// Identity and provider are fixed here, never accepted from the request body.
func cashObservationsHandler(database cashObservationStore, mu *sync.RWMutex) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(status int, message string) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			fail(http.StatusMethodNotAllowed, "POST required")
			return
		}
		var body struct {
			Checkpoints []struct {
				AccountID        string   `json:"accountId"`
				PostedBalance    *float64 `json:"postedBalance"`
				AvailableBalance *float64 `json:"availableBalance"`
				ObservedAt       int64    `json:"observedAt"`
			} `json:"checkpoints"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			fail(http.StatusBadRequest, "invalid observations")
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF || len(body.Checkpoints) == 0 {
			fail(http.StatusBadRequest, "one nonempty checkpoint batch required")
			return
		}
		mu.Lock()
		defer mu.Unlock()
		model, err := database.LoadModel()
		if err != nil || model == nil {
			fail(http.StatusInternalServerError, "cannot load fixture model")
			return
		}
		known := map[string]bool{}
		for _, account := range model.Accounts {
			known[account.ID] = true
		}
		type key struct {
			account string
			instant int64
		}
		owner := map[key]bool{}
		for _, cp := range model.Checkpoints {
			if cp.Source != store.SourceBankSync {
				owner[key{cp.AccountID, cp.ObservedAt}] = true
			}
		}
		seen := map[key]bool{}
		checkpoints := make([]store.SyncCheckpoint, 0, len(body.Checkpoints))
		for _, cp := range body.Checkpoints {
			identity := key{cp.AccountID, cp.ObservedAt}
			finite := func(value *float64) bool { return value == nil || (!math.IsNaN(*value) && !math.IsInf(*value, 0)) }
			if !known[cp.AccountID] || cp.PostedBalance == nil || !finite(cp.PostedBalance) || !finite(cp.AvailableBalance) || cp.ObservedAt <= 0 || cp.ObservedAt > time.Now().Unix() || seen[identity] || owner[identity] {
				fail(http.StatusUnprocessableEntity, "checkpoint requires an existing account, finite balances, a past observation instant, and a unique non-owner key")
				return
			}
			seen[identity] = true
			checkpoints = append(checkpoints, store.SyncCheckpoint{
				AccountID: cp.AccountID, Balance: *cp.PostedBalance, AvailableBalance: cp.AvailableBalance,
				ObservedAt: cp.ObservedAt, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN,
			})
		}
		if _, err := database.ApplySync(checkpoints, nil); err != nil {
			fail(http.StatusInternalServerError, "cannot save fixture observations")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"saved": true, "observations": len(checkpoints)})
	})
}
