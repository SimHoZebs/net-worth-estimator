package identity

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

func (s *Service) introspect(ctx context.Context, g grant) error {
	result, err := s.postIntrospection(ctx, g.AccessToken)
	if err != nil {
		return err
	}
	if result.Subject != g.Subject || result.ClientID != s.config.ClientID || result.Issuer != s.config.Issuer || !audienceMatches(result.Audience, s.config.ClientID) {
		return errGrantRevoked
	}
	return nil
}

// introspectionResult mirrors the provider response fields the server
// trusts. Audience matching stays with the result so every caller applies
// the same client binding.
type introspectionResult struct {
	Active   *bool           `json:"active"`
	Subject  string          `json:"sub"`
	ClientID string          `json:"client_id"`
	Issuer   string          `json:"iss"`
	Audience json.RawMessage `json:"aud"`
}

// audienceMatches accepts the provider's string-or-array audience encoding
// and reports whether it names this application client.
func audienceMatches(raw json.RawMessage, clientID string) bool {
	var audiences []string
	if json.Unmarshal(raw, &audiences) != nil {
		var audience string
		if json.Unmarshal(raw, &audience) == nil {
			audiences = []string{audience}
		}
	}
	for _, audience := range audiences {
		if audience == clientID {
			return true
		}
	}
	return false
}

func (s *Service) postIntrospection(ctx context.Context, accessToken string) (introspectionResult, error) {
	var result introspectionResult
	form := url.Values{"token": {accessToken}, "token_type_hint": {"access_token"}}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, s.introspection, strings.NewReader(form.Encode()))
	if err != nil {
		return result, err
	}
	r.SetBasicAuth(s.config.ClientID, s.config.ClientSecret)
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.client.Do(r)
	if err != nil {
		return result, errors.New("provider introspection unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, errors.New("provider introspection rejected request")
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(&result); err != nil || result.Active == nil {
		return result, errors.New("invalid provider introspection response")
	}
	if !*result.Active {
		return result, errGrantRevoked
	}
	return result, nil
}

func (s *Service) validateGrant(ctx context.Context, id string) (grant, error) {
	if id == "" {
		return grant{}, nil
	}
	g, err := s.store.findGrant(id, s.config.Issuer)
	if err != nil || g.ID == "" {
		return g, err
	}
	if time.Since(time.Unix(0, g.CheckedAt)) < s.config.RecheckInterval && time.Now().Add(10*time.Second).Unix() < g.TokenExpiry {
		return g, nil
	}
	// Rotating refresh tokens belong to a persisted grant, not an individual
	// request. Concurrent browser/API requests share one revalidation/refresh.
	result, err, _ := s.validation.Do(id, func() (any, error) {
		current, err := s.store.findGrant(id, s.config.Issuer)
		if err != nil || current.ID == "" {
			return current, err
		}
		if time.Since(time.Unix(0, current.CheckedAt)) < s.config.RecheckInterval && time.Now().Add(10*time.Second).Unix() < current.TokenExpiry {
			return current, nil
		}
		providerContext := oidc.ClientContext(ctx, s.client)
		if time.Now().Add(10*time.Second).Unix() >= current.TokenExpiry {
			token, err := s.oauth.TokenSource(providerContext, &oauth2.Token{AccessToken: current.AccessToken,
				RefreshToken: current.RefreshToken, TokenType: "Bearer", Expiry: time.Unix(current.TokenExpiry, 0)}).Token()
			if err != nil {
				var rejection *oauth2.RetrieveError
				if errors.As(err, &rejection) && (rejection.ErrorCode == "invalid_grant" || rejection.ErrorCode == "invalid_token") {
					return grant{}, s.discardGrant(current)
				}
				return grant{}, errors.New("provider refresh unavailable")
			}
			identity, err := s.verifiedIdentity(providerContext, token, current.Nonce, current.Subject)
			if err != nil || token.AccessToken == "" {
				return grant{}, s.discardGrant(current)
			}
			current.AccessToken = token.AccessToken
			if token.RefreshToken != "" {
				current.RefreshToken = token.RefreshToken
			}
			current.IDToken, _ = token.Extra("id_token").(string)
			current.TokenExpiry = tokenDeadline(token, identity)
			// Rotation is already committed at the provider. Preserve the new
			// credentials even if the following introspection temporarily fails.
			// Keep CheckedAt stale so the next request still validates them.
			if err := s.store.updateGrant(current); err != nil {
				if errors.Is(err, errGrantRevoked) {
					return grant{}, nil
				}
				return grant{}, err
			}
		}
		if err := s.introspect(providerContext, current); err != nil {
			if errors.Is(err, errGrantRevoked) {
				return grant{}, s.discardGrant(current)
			}
			return grant{}, err
		}
		current.CheckedAt = time.Now().UnixNano()
		if err := s.store.updateGrant(current); err != nil {
			if errors.Is(err, errGrantRevoked) {
				return grant{}, nil
			}
			return grant{}, err
		}
		return current, nil
	})
	if err != nil {
		return grant{}, err
	}
	return result.(grant), nil
}

func (s *Service) discardGrant(g grant) error { return s.store.deleteGrant(g.ID, g.Issuer) }
