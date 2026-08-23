package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Server-side artifact cache: content-addressed reuse of completed
// projections across requests and reloads (ASSUMPTIONS A2/N-followup).
// Identity is Go-owned; no cross-implementation hash compatibility is kept.

const artifactCacheVersion = 1

func mustCanonical(payload any) string {
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(fmt.Sprintf("artifact canonical marshal: %v", err))
	}
	return string(encoded)
}

func artifactKey(kind string, descriptor any) string {
	digest := sha256.Sum256([]byte(mustCanonical(map[string]any{
		"artifactCacheVersion": artifactCacheVersion,
		"kind":                 kind,
		"descriptor":           descriptor,
	})))
	return fmt.Sprintf("%s:%d:%s", kind, artifactCacheVersion, hex.EncodeToString(digest[:]))
}

type cachedPayload[T any] struct {
	value T
	hit   bool
}

func lookupArtifact[T any](st *store.Store, key string) (cachedPayload[T], error) {
	payload, ok, err := st.GetArtifact(key)
	if err != nil || !ok {
		return cachedPayload[T]{}, err
	}
	var value T
	if err := json.Unmarshal([]byte(payload), &value); err != nil {
		// Corrupt or foreign payload: treat as a miss.
		return cachedPayload[T]{}, nil
	}
	return cachedPayload[T]{value: value, hit: true}, nil
}

func putArtifact[T any](st *store.Store, key, kind string, value T) {
	payload, err := json.Marshal(value)
	if err != nil {
		return // best-effort cache write
	}
	_ = st.PutArtifact(key, kind, string(payload))
}

// projectionSettingsDescriptor strips label-only fields from evaluation
// tables so renaming an instance does not invalidate cached computation.
func projectionSettingsDescriptor(settings types.ProjectionRuntimeSettings) map[string]any {
	return map[string]any{
		"fallbackProjectionStartDate": settings.FallbackProjectionStartDate,
		"horizonYears":                settings.HorizonYears,
		"evaluations":                 evaluationDescriptor(&settings.Evaluations),
	}
}

type evaluationConfigEntry struct {
	instanceID string
	label      string
	enabled    bool
	config     types.JsonValue
}

func evaluationDescriptor(tables *types.EvaluationTables) map[string]any {
	collect := func(entries []evaluationConfigEntry) []map[string]any {
		out := make([]map[string]any, 0, len(entries))
		for _, entry := range entries {
			if !entry.enabled {
				continue // disabled configs never affect computation
			}
			out = append(out, map[string]any{
				"instanceId": entry.instanceID,
				"config":     entry.config,
			})
		}
		return out
	}
	fi := make([]evaluationConfigEntry, 0, len(tables.FinancialIndependence))
	for _, item := range tables.FinancialIndependence {
		fi = append(fi, evaluationConfigEntry{item.InstanceID, item.Label, item.Enabled, item.Config})
	}
	nw := make([]evaluationConfigEntry, 0, len(tables.NetWorthThreshold))
	for _, item := range tables.NetWorthThreshold {
		nw = append(nw, evaluationConfigEntry{item.InstanceID, item.Label, item.Enabled, item.Config})
	}
	pf := make([]evaluationConfigEntry, 0, len(tables.PostingFulfillment))
	for _, item := range tables.PostingFulfillment {
		pf = append(pf, evaluationConfigEntry{item.InstanceID, item.Label, item.Enabled, item.Config})
	}
	return map[string]any{
		"financialIndependence": collect(fi),
		"netWorthThreshold":     collect(nw),
		"postingFulfillment":    collect(pf),
	}
}
