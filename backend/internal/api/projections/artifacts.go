package projections

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

// Completed simulation results are stored as content-addressed artifacts.
// artifactKey defines the backend-owned identity from simulation inputs.
// artifactIdentityVersion covers the key envelope; deterministicResultVersion
// covers the deterministic payload shape. Bump both when either changes so
// incompatible results are not retrieved. Storage retains at most maxArtifacts
// across result kinds (store/artifacts.go).

const artifactIdentityVersion = 8

// Projection-Source identifies the result's origin, not persistence success.
// Computed and shared responses may still end with an execution error.
const (
	projectionSourceStored   = "stored"
	projectionSourceComputed = "computed"
	projectionSourceShared   = "shared"
)

func mustCanonical(payload any) string {
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(fmt.Sprintf("artifact canonical marshal: %v", err))
	}
	return string(encoded)
}

func (s *handler) resourceArtifactKey(kind string, descriptor any) string {
	if s.resourceID == "" {
		return artifactKey(kind, descriptor)
	}
	return artifactKey(kind, map[string]any{"resource": s.resourceID, "request": descriptor})
}

func artifactKey(kind string, descriptor any) string {
	digest := sha256.Sum256([]byte(mustCanonical(map[string]any{
		// Keep the serialized field name stable to preserve existing identities.
		"artifactCacheVersion": artifactIdentityVersion,
		"kind":                 kind,
		"descriptor":           descriptor,
	})))
	return fmt.Sprintf("%s:%d:%s", kind, artifactIdentityVersion, hex.EncodeToString(digest[:]))
}

type storedArtifact[T any] struct {
	value T
	found bool
}

func lookupArtifact[T any](st store.Store, key string) (storedArtifact[T], error) {
	payload, ok, err := st.GetArtifact(key)
	if err != nil || !ok {
		logArtifactLookup(key, false)
		return storedArtifact[T]{}, err
	}
	var value T
	if err := json.Unmarshal([]byte(payload), &value); err != nil {
		// Corrupt or foreign payload: no usable stored result.
		logArtifactLookup(key, false)
		return storedArtifact[T]{}, nil
	}
	logArtifactLookup(key, true)
	return storedArtifact[T]{value: value, found: true}, nil
}

// logArtifactLookup logs availability, result kind, and an identity prefix,
// never simulation inputs or result payloads.
func logArtifactLookup(key string, found bool) {
	kind, prefix := parseArtifactKeyMeta(key)
	result := "unavailable"
	if found {
		result = "found"
	}
	log.Printf("simulation result lookup kind=%s result=%s key_prefix=%s", kind, result, prefix)
}

// parseArtifactKeyMeta splits keys shaped "kind:version:hexdigest" into the
// result kind and the first 8 hex chars of the digest.
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

func putArtifact[T any](st store.Store, key, kind string, value T) {
	payload, err := json.Marshal(value)
	if err != nil {
		return // best-effort result storage
	}
	_ = st.PutArtifact(key, kind, string(payload))
}

// projectionSettingsDescriptor omits names from settings evaluation tables.
// The complete model document contributes separately to result identity.
func projectionSettingsDescriptor(settings types.ProjectionRuntimeSettings) map[string]any {
	return map[string]any{
		"fallbackProjectionStartDate": settings.FallbackProjectionStartDate,
		"horizonYears":                settings.HorizonYears,
		"asOfInstant":                 settings.AsOfInstant,
		"evaluations":                 evaluationDescriptor(&settings.Evaluations),
	}
}

func evaluationDescriptor(tables *types.EvaluationTables) map[string]any {
	out := map[string]any{}
	for _, table := range tables.Tables() {
		out[table.Type] = enabledEvaluationConfigs(*table.Rows)
	}
	return out
}

// enabledEvaluationConfigs describes enabled evaluation IDs and configs,
// without labels, for the settings portion of result identity.
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
