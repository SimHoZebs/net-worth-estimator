package api

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
)

type syncOutput struct {
	Body simplefin.Summary
}

// retryAfterHeader converts a wait duration to a Retry-After header value,
// rounding up to whole seconds with a one-second floor so "0" never tells a
// hammering client to retry immediately.
func retryAfterHeader(wait time.Duration) http.Header {
	seconds := int64(math.Ceil(wait.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	return http.Header{"Retry-After": []string{strconv.FormatInt(seconds, 10)}}
}

func tooManyRequests(wait time.Duration, message string) error {
	return huma.ErrorWithHeaders(
		huma.Error429TooManyRequests(message),
		retryAfterHeader(wait),
	)
}

func (s *Server) triggerSync(ctx context.Context, _ *struct{}) (*syncOutput, error) {
	if s.SyncRunner == nil {
		return nil, huma.Error503ServiceUnavailable("simplefin sync is not configured")
	}
	summary, err := s.SyncRunner.Trigger(ctx)
	if err != nil {
		var tooSoon *simplefin.TooSoonError
		if errors.As(err, &tooSoon) {
			return nil, tooManyRequests(tooSoon.RetryAfter, tooSoon.Error())
		}
		var rateLimited *simplefin.RateLimitedError
		if errors.As(err, &rateLimited) {
			wait := rateLimited.RetryAfter
			if wait <= 0 {
				wait = simplefin.DefaultRateLimitCooldown
			}
			return nil, tooManyRequests(wait, rateLimited.Error())
		}
		var inProgress *simplefin.InProgressError
		if errors.As(err, &inProgress) {
			return nil, huma.Error409Conflict(inProgress.Error())
		}
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &syncOutput{Body: *summary}, nil
}
