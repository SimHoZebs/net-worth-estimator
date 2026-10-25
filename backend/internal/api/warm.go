package api

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Background projection warming: recompute cached probabilities after saves
// so pins read hits instead of triggering 10-second foreground runs.
//
// Warm parameters mirror the frontend defaults exactly, or warmed artifacts
// never match frontend requests: horizon in frontend/src/state/uiStore.ts,
// runCount and seed in frontend/src/state/useRemoteProjection.ts. The
// fallback start date below mirrors projectionStartDate in the same file.
// If any side changes its default, update both and note it here.

// WarmParams selects which cached projection to warm. RunCount is clamped to
// [1, 10000] by the stochastic session; Seed is always set so warmed runs
// are content-addressed and shared.
type WarmParams struct {
	HorizonYears int
	RunCount     int
	Seed         int64
}

// WarmDefaults warms the default Outlook view: 20-year horizon, 400 seeded
// runs. Other horizons still compute on demand.
func WarmDefaults() WarmParams {
	return WarmParams{HorizonYears: 20, RunCount: 400, Seed: 42}
}

// warmFallbackStartDate mirrors the frontend projectionStartDate: latest
// checkpoint date, else first rule start, else first non-purchase posting
// date, else today. Warmed keys must equal frontend-requested keys.
func warmFallbackStartDate(document *types.FinancialModelDocument) string {
	latest := ""
	for _, checkpoint := range document.Checkpoints {
		if checkpoint.Date > latest {
			latest = checkpoint.Date
		}
	}
	if latest != "" {
		return latest
	}
	if len(document.RecurrenceRules) > 0 {
		return document.RecurrenceRules[0].StartDate
	}
	for _, posting := range document.Postings {
		if posting.Purchase != nil {
			continue
		}
		when := posting.TransactionTime
		if when <= 0 {
			when = posting.PostedTime
		}
		return time.Unix(when, 0).UTC().Format("2006-01-02")
	}
	return time.Now().UTC().Format("2006-01-02")
}

// deterministicWarmDescriptor matches projectDeterministic's cache
// descriptor for a stored document with no overrides.
func deterministicWarmDescriptor(document *types.FinancialModelDocument, settings types.ProjectionRuntimeSettings) map[string]any {
	return map[string]any{
		"publicResultVersion": deterministicResultCacheVersion,
		"document":            document,
		"overrides":           types.ModelOverrides{},
		"settings":            projectionSettingsDescriptor(settings),
	}
}

// stochasticWarmDescriptor matches stochasticSSE's cache descriptor for a
// stored document with no overrides.
func stochasticWarmDescriptor(document *types.FinancialModelDocument, settings types.ProjectionRuntimeSettings, params WarmParams) map[string]any {
	seed := params.Seed
	return map[string]any{
		"document":  document,
		"overrides": types.ModelOverrides{},
		"settings":  projectionSettingsDescriptor(settings),
		"config": map[string]any{
			"runCount": params.RunCount,
			"seed":     &seed,
		},
	}
}

// reportsMutation decides whether a request can change projection inputs.
// Projections never mutate stored data, and sync, pins, presets, and auth
// never affect projection identity (sync trigger reports separately with
// its dry-run flag), so warming for them would only waste work.
func reportsMutation(method, path string) bool {
	if method != http.MethodPost && method != http.MethodPatch && method != http.MethodPut && method != http.MethodDelete {
		return false
	}
	if !strings.HasPrefix(path, "/v1/") {
		return false
	}
	if strings.HasPrefix(path, "/v1/projections/") ||
		strings.HasPrefix(path, "/v1/auth/") ||
		strings.HasPrefix(path, "/v1/sync/") ||
		path == "/v1/pinned-evaluations" ||
		strings.HasPrefix(path, "/v1/pinned-evaluations/") ||
		path == "/v1/amount-presets" ||
		strings.HasPrefix(path, "/v1/amount-presets/") {
		return false
	}
	return true
}

// mutationNotifyMiddleware reports successful state changes to the owner.
// A rejected write still reports, but WarmResource skips present
// artifacts, so false positives cost lookups instead of recomputes.
func mutationNotifyMiddleware(onMutated func(string), resourceID string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if onMutated == nil || !reportsMutation(r.Method, r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			recorder := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(recorder, r)
			if recorder.status >= 200 && recorder.status < 300 {
				onMutated(resourceID)
			}
		})
	}
}

// statusRecorder captures the response status for post-handler decisions.
// Unwrap preserves ResponseController behavior (flushing) for wrapped
// handlers.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusRecorder) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(body)
}

func (w *statusRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Flush forwards to the underlying writer so a future exclusion slip fails
// safe instead of breaking streaming assertions. Projections are excluded
// before wrapping, so this path stays cold today.
func (w *statusRecorder) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// warmDeterministicGroup joins overlapping warms the way overlapping
// stochastic warms join the shared-run registry: one leader computes while
// followers wait, then share the artifact. Sequential warms still recheck
// presence first. Puts stay idempotent either way.
var warmDeterministicGroup singleflight.Group

// WarmResource recomputes the cached deterministic and seeded stochastic
// projections for one resource when they are absent. Present artifacts are
// left alone, so rejected writes, dry runs, and duplicate marks cost one
// document load plus two lookups instead of a recompute. Failures are
// returned for logging; callers must never fail a request because warming
// failed.
func WarmResource(ctx context.Context, st store.Store, resourceID string, params WarmParams) error {
	document, err := st.LoadDocument()
	if err != nil {
		return err
	}
	if document == nil {
		return nil
	}
	settings := types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: warmFallbackStartDate(document),
		HorizonYears:                params.HorizonYears,
		Evaluations:                 document.Evaluations,
	}
	overrides := types.ModelOverrides{}

	detKey := resourceArtifactKeyFor(resourceID, "deterministic", deterministicWarmDescriptor(document, settings))
	if cached, err := lookupArtifact[types.ProjectionResult](st, detKey); err != nil || !cached.hit {
		_, err, _ := warmDeterministicGroup.Do(detKey, func() (any, error) {
			_, prefix := parseArtifactKeyMeta(detKey)
			log.Printf("warm deterministic recalc key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d",
				prefix, len(document.Accounts), len(document.Postings), len(document.Checkpoints), settings.HorizonYears)
			result, err := domain.ProjectFinancialModelDocument(document, &settings, overrides, nil)
			if err != nil {
				return nil, err
			}
			putArtifact(st, detKey, "deterministic", result)
			return nil, nil
		})
		if err != nil {
			return err
		}
	}

	stochKey := resourceArtifactKeyFor(resourceID, "stochastic", stochasticWarmDescriptor(document, settings, params))
	if cached, err := lookupArtifact[types.StochasticProjectionResult](st, stochKey); err == nil && cached.hit {
		return nil
	}
	_, prefix := parseArtifactKeyMeta(stochKey)
	log.Printf("warm stochastic recalc key_prefix=%s accounts=%d postings=%d checkpoints=%d horizon=%d runs=%d",
		prefix, len(document.Accounts), len(document.Postings), len(document.Checkpoints), settings.HorizonYears, params.RunCount)
	seed := params.Seed
	config := types.StochasticConfig{RunCount: params.RunCount, Seed: &seed}
	run, owner := getOrStartSharedRun(stochKey)
	if !owner {
		// A foreground request owns this run; its completion persists the
		// artifact, so warming only waits for it.
		<-run.done
		_, runErr := run.outcome()
		return runErr
	}
	result, runErr := domain.StochasticProjection(ctx, document, &settings, overrides, config, nil)
	run.finish(stochKey, func(result *types.StochasticProjectionResult) {
		putArtifact(st, stochKey, "stochastic", result)
	}, result, runErr)
	if runErr != nil {
		log.Printf("warm stochastic finish key_prefix=%s status=error error=%v", prefix, runErr)
		return runErr
	}
	log.Printf("warm stochastic finish key_prefix=%s status=ok runs=%d", prefix, params.RunCount)
	return nil
}
