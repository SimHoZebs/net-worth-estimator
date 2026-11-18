package analyses

import (
	"context"
	"errors"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// patternRuleMu serializes preview-then-mutate pattern actions within one
// server instance. Preview plus the finance write are separate store calls;
// without this, two concurrent actions for one pattern could both pass
// preview and each mint their own rule or overlapping claims. The store
// contract already assumes one server and one instance, so a process-wide
// mutex matches the deployment.
var patternRuleMu sync.Mutex

// patternPreviewCacheControl is the single preview envelope for both
// pattern flows: previews never cache.
const patternPreviewCacheControl = "private, no-store"

// patternRuleError maps store failures to the shared forecast-schedule
// contract, parameterized by the per-flow invalid/conflict sentinels.
func patternRuleError(err error, invalid, conflict error, unavailable string) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return huma.Error404NotFound("Finding not found")
	case errors.Is(err, invalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, conflict):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error500InternalServerError(unavailable)
	}
}

func (s *handler) requirePatternWrite(ctx context.Context) error {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return huma.Error403Forbidden("Write permission is required")
	}
	return nil
}
