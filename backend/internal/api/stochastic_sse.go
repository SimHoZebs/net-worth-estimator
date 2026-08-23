package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// stochasticSSE streams StochasticProgress events plus optional partial
// results, mirroring the TS worker postMessage protocol over SSE.
func (s *Server) stochasticSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	var body struct {
		Document   *types.FinancialModelDocument   `json:"document,omitempty"`
		Overrides  types.ModelOverrides            `json:"overrides"`
		Settings   types.ProjectionRuntimeSettings `json:"settings"`
		Config     types.StochasticConfig          `json:"config"`
		IncomeData *types.IncomeDataSnapshot       `json:"incomeData,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	document, incomeData, err := s.resolveDocument(body.Document, body.IncomeData)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Unseeded runs are never cached: a nil seed means "fresh random draw",
	// matching TS semantics. The shipped frontend always materializes a
	// concrete seed before sending, so app traffic is cache-eligible.
	cacheEligible := body.Config.Seed != nil
	var cacheKey string
	if cacheEligible {
		cacheKey = artifactKey("stochastic", map[string]any{
			"document":   document,
			"overrides":  body.Overrides,
			"settings":   projectionSettingsDescriptor(body.Settings),
			"incomeData": incomeData,
			"config": map[string]any{
				"runCount": body.Config.RunCount,
				"seed":     body.Config.Seed,
			},
		})
		if cached, err := lookupArtifact[types.StochasticProjectionResult](s.store, cacheKey); err == nil && cached.hit {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Cache", "hit")
			w.WriteHeader(http.StatusOK)
			encoded, marshalErr := json.Marshal(map[string]any{"result": cached.value})
			if marshalErr == nil {
				fmt.Fprintf(w, "event: result\ndata: %s\n\n", encoded)
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			return
		}
	}
	w.Header().Set("X-Cache", "miss")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	writeEvent := func(name string, payload any) error {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, encoded); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	progressCallback := func(progress types.StochasticProgress, partial *types.StochasticProjectionResult) {
		payload := map[string]any{"progress": progress}
		eventName := "progress"
		if partial != nil {
			eventName = "partial"
			payload["partial"] = partial
		}
		_ = writeEvent(eventName, payload)
	}

	ctx := r.Context()
	result, runErr := domain.StochasticProjection(ctx, document, &body.Settings, body.Overrides, body.Config, progressCallback, incomeData)
	if runErr != nil {
		_ = writeEvent("error", map[string]any{"error": runErr.Error()})
		return
	}
	if cacheEligible {
		putArtifact(s.store, cacheKey, "stochastic", result)
	}
	_ = writeEvent("result", map[string]any{"result": result})
}
