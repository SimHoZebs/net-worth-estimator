package sync

import (
	"context"
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
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

func (s *handler) triggerSync(ctx context.Context, _ *struct{}) (*syncOutput, error) {
	if s.runner == nil || !s.runner.IsConfigured() {
		return nil, huma.Error503ServiceUnavailable("simplefin sync is not configured")
	}
	summary, err := s.runner.Trigger(ctx)
	if err != nil {
		var notConfigured *simplefin.NotConfiguredError
		if errors.As(err, &notConfigured) {
			return nil, huma.Error503ServiceUnavailable("simplefin sync is not configured")
		}
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

type syncCredentialBody struct {
	Configured bool `json:"configured"`
	// BridgeHost names the Bridge host for display. Never the secret.
	BridgeHost string `json:"bridgeHost,omitempty"`
	// UpdatedAt is the RFC3339 connection time, omitted when unconfigured.
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type syncCredentialOutput struct {
	Body syncCredentialBody
}

type syncCredentialInput struct {
	Body struct {
		// SetupToken is the pasted base64 SimpleFIN setup token. The server
		// claims it once and stores the resulting Access URL.
		SetupToken string `json:"setupToken,omitempty"`
		// AccessURL is an already-claimed Bridge Access URL paste fallback.
		AccessURL string `json:"accessUrl,omitempty"`
	}
}

type syncCardsOutput struct {
	Body struct {
		Cards []string `json:"cards"`
	}
}

type syncCardsInput struct {
	Body struct {
		Cards []string `json:"cards"`
	}
}

func (s *handler) getSyncCredential(_ context.Context, _ *struct{}) (*syncCredentialOutput, error) {
	credential, err := s.store.GetSyncCredential()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	body := syncCredentialBody{Configured: credential.AccessURL != ""}
	if body.Configured {
		body.BridgeHost = credential.BridgeHost
		body.UpdatedAt = credential.UpdatedAt
	}
	return &syncCredentialOutput{Body: body}, nil
}

// connectSyncCredential stores a per-plan Bridge key. Like account links,
// the credential is scoped to the calling plan; only the primary owner's
// runner consumes it, so a non-primary plan reports configured here while
// its own trigger stays 503.
func (s *handler) connectSyncCredential(ctx context.Context, input *syncCredentialInput) (*syncCredentialOutput, error) {
	setupToken := strings.TrimSpace(input.Body.SetupToken)
	accessURL := strings.TrimSpace(input.Body.AccessURL)
	if (setupToken == "") == (accessURL == "") {
		return nil, huma.Error400BadRequest("provide exactly one of setupToken or accessUrl")
	}
	// Detect the initial connection before storing: only a first-ever key
	// earns one automatic sync. A rotation stays manual so a recent trigger
	// or blackout is not forced through twice.
	var wasInitial bool
	if previous, err := s.store.GetSyncCredential(); err == nil {
		wasInitial = previous.AccessURL == ""
	}
	if setupToken != "" {
		claimURL, err := simplefin.DecodeSetupToken(setupToken)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		claimed, err := simplefin.ClaimAccessURL(ctx, nil, claimURL)
		if err != nil {
			var used *simplefin.ClaimUsedError
			if errors.As(err, &used) {
				return nil, huma.Error400BadRequest(used.Error())
			}
			return nil, huma.Error502BadGateway(err.Error())
		}
		accessURL = claimed
	} else if _, err := simplefin.ParseAccessURL(accessURL); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	stored, err := s.store.SetSyncCredential(accessURL, simplefin.BridgeHost(accessURL))
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	// One forced sync on initial connection so balances appear without
	// waiting for the 6-hour scheduler. Sync (not Trigger) bypasses only
	// the manual interval: it still honors the in-flight guard and the
	// post-429 blackout, and it leaves lastTrigger untouched so the manual
	// throttle is not overridden. Best-effort: a throttled or failed sync
	// never fails the connect itself. Only the primary plan has a runner;
	// other plans just store their key.
	if wasInitial && s.runner != nil {
		if summary, err := s.runner.Sync(ctx); err != nil {
			log.Printf("simplefin initial sync failed: %v", err)
		} else {
			log.Printf("simplefin initial sync: %+v", summary)
		}
	}
	return &syncCredentialOutput{Body: syncCredentialBody{Configured: true, BridgeHost: stored.BridgeHost, UpdatedAt: stored.UpdatedAt}}, nil
}

func (s *handler) disconnectSyncCredential(_ context.Context, _ *struct{}) (*syncCredentialOutput, error) {
	if err := s.store.ClearSyncCredential(); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &syncCredentialOutput{Body: syncCredentialBody{Configured: false}}, nil
}

func (s *handler) getSyncCards(_ context.Context, _ *struct{}) (*syncCardsOutput, error) {
	cards, err := s.store.GetSyncCards()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if cards == nil {
		cards = []string{}
	}
	output := &syncCardsOutput{}
	output.Body.Cards = cards
	return output, nil
}

func (s *handler) setSyncCards(_ context.Context, input *syncCardsInput) (*syncCardsOutput, error) {
	cards := input.Body.Cards
	if cards == nil {
		cards = []string{}
	}
	seen := map[string]struct{}{}
	cleaned := make([]string, 0, len(cards))
	for _, id := range cards {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			return nil, huma.Error400BadRequest("card account IDs must not be blank")
		}
		if _, dup := seen[trimmed]; dup {
			return nil, huma.Error400BadRequest("duplicate card account ID: " + trimmed)
		}
		seen[trimmed] = struct{}{}
		cleaned = append(cleaned, trimmed)
	}
	if document, err := s.store.LoadDocument(); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	} else if document != nil && len(cleaned) > 0 {
		known := map[string]struct{}{}
		for _, account := range document.Accounts {
			known[account.ID] = struct{}{}
		}
		for _, id := range cleaned {
			if _, ok := known[id]; !ok {
				return nil, huma.Error422UnprocessableEntity("unknown account: " + id)
			}
		}
	}
	stored, err := s.store.SetSyncCards(cleaned)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output := &syncCardsOutput{}
	output.Body.Cards = stored
	if output.Body.Cards == nil {
		output.Body.Cards = []string{}
	}
	return output, nil
}
