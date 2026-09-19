package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strings"

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
		logArtifactLookup(key, false)
		return cachedPayload[T]{}, err
	}
	var value T
	if err := json.Unmarshal([]byte(payload), &value); err != nil {
		// Corrupt or foreign payload: treat as a miss.
		logArtifactLookup(key, false)
		return cachedPayload[T]{}, nil
	}
	logArtifactLookup(key, true)
	return cachedPayload[T]{value: value, hit: true}, nil
}

// logArtifactLookup emits one measurement line per artifact lookup for
// week-long hit-rate analysis. Only the cache kind, hit/miss outcome, and
// the first 8 hex chars of the identity hash are logged; never payloads.
func logArtifactLookup(key string, hit bool) {
	kind, prefix := parseArtifactKeyMeta(key)
	result := "miss"
	if hit {
		result = "hit"
	}
	log.Printf("artifact cache lookup kind=%s result=%s key_prefix=%s", kind, result, prefix)
}

// parseArtifactKeyMeta splits keys shaped "kind:version:hexdigest" into the
// cache kind and the first 8 hex chars of the digest.
func parseArtifactKeyMeta(key string) (string, string) {
	kind := "unknown"
	if idx := strings.Index(key, ":"); idx > 0 {
		kind = key[:idx]
	}
	digest := key
	if idx := strings.LastIndex(key, ":"); idx >= 0 && idx+1 < len(key) {
		digest = key[idx+1:]
	}
	if len(digest) > 8 {
		digest = digest[:8]
	}
	if digest == "" {
		digest = "unknown"
	}
	return kind, digest
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

func evaluationDescriptor(tables *types.EvaluationTables) map[string]any {
	return map[string]any{
		"financialIndependence": enabledEvaluationConfigs(tables.FinancialIndependence),
		"netWorthThreshold":     enabledEvaluationConfigs(tables.NetWorthThreshold),
		"postingFulfillment":    enabledEvaluationConfigs(tables.PostingFulfillment),
	}
}

// enabledEvaluationConfigs strips label-only fields from evaluation tables
// so renaming an instance does not invalidate cached computation. Disabled
// configs never affect computation.
func enabledEvaluationConfigs(items []types.EvaluationInstance[types.JsonValue]) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if !item.Enabled {
			continue
		}
		out = append(out, map[string]any{
			"instanceId": item.InstanceID,
			"config":     item.Config,
		})
	}
	return out
}
