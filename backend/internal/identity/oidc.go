package identity

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
)

func (s *Service) login(w http.ResponseWriter, r *http.Request) {
	endpoint, _ := s.browserEndpoint(r)
	if s.sessions.GetString(r.Context(), "grant_id") == "" {
		s.sessions.SetDeadline(r.Context(), time.Now().Add(10*time.Minute))
	}
	state, nonce, verifier := oauth2.GenerateVerifier(), oauth2.GenerateVerifier(), oauth2.GenerateVerifier()
	pending := loadPendingLogins(s.sessions.GetString(r.Context(), "pending_logins"))
	pending[state] = pendingLogin{Nonce: nonce, Verifier: verifier, Origin: endpoint.app, At: time.Now().UnixNano()}
	s.sessions.Put(r.Context(), "pending_logins", savePendingLogins(pending))
	oauth := s.browserOAuth(endpoint)
	http.Redirect(w, r, oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

// pendingLogin tracks one outstanding authorization redirect. Several can
// coexist when sign-in starts twice (a second tap, a restored tab, back and
// forth between app and provider). Each callback consumes only its own entry,
// so finishing the older flow still validates.
type pendingLogin struct {
	Nonce    string
	Verifier string
	Origin   string
	At       int64
}

func loadPendingLogins(raw string) map[string]pendingLogin {
	pending := map[string]pendingLogin{}
	if raw == "" {
		return pending
	}
	var decoded map[string]pendingLogin
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return pending
	}
	for state, entry := range decoded {
		if entry.Nonce == "" || entry.Verifier == "" || entry.Origin == "" || time.Since(time.Unix(0, entry.At)) > 10*time.Minute {
			continue
		}
		pending[state] = entry
	}
	for len(pending) > 3 {
		oldest := ""
		for state, entry := range pending {
			if oldest == "" || entry.At < pending[oldest].At {
				oldest = state
			}
		}
		delete(pending, oldest)
	}
	return pending
}

func savePendingLogins(pending map[string]pendingLogin) string {
	raw, err := json.Marshal(pending)
	if err != nil {
		return ""
	}
	return string(raw)
}

func (s *Service) verifiedIdentity(ctx context.Context, token *oauth2.Token, nonce, subject string) (*oidc.IDToken, error) {
	raw, _ := token.Extra("id_token").(string)
	id, err := s.provider.Verifier(&oidc.Config{ClientID: s.config.ClientID}).Verify(ctx, raw)
	if err != nil || id.Subject == "" || id.IssuedAt.Unix() <= 0 || id.IssuedAt.After(time.Now().Add(30*time.Second)) {
		return nil, errors.New("invalid provider identity")
	}
	if subject == "" || id.Nonce != "" {
		if subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(nonce)) != 1 {
			return nil, errors.New("invalid identity nonce")
		}
	}
	if subject != "" && id.Subject != subject {
		return nil, errors.New("refreshed identity changed subject")
	}
	if id.AccessTokenHash != "" {
		if err := id.VerifyAccessToken(token.AccessToken); err != nil {
			return nil, errors.New("invalid provider token binding")
		}
	}
	return id, nil
}

func (s *Service) callback(w http.ResponseWriter, r *http.Request) {
	endpoint, _ := s.browserEndpoint(r)
	pending := loadPendingLogins(s.sessions.GetString(r.Context(), "pending_logins"))
	var entry pendingLogin
	for state, candidate := range pending {
		if subtle.ConstantTimeCompare([]byte(state), []byte(r.URL.Query().Get("state"))) == 1 {
			entry = candidate
			delete(pending, state)
			break
		}
	}
	s.sessions.Put(r.Context(), "pending_logins", savePendingLogins(pending))
	started := time.Unix(0, entry.At)
	if entry.Origin != endpoint.app || entry.Nonce == "" || entry.Verifier == "" || time.Since(started) > 10*time.Minute || started.After(time.Now().Add(30*time.Second)) || r.URL.Query().Get("code") == "" {
		failure(w, 400, "The login expired or its state is invalid. Start sign-in again.")
		return
	}
	ctx := oidc.ClientContext(r.Context(), s.client)
	oauth := s.browserOAuth(endpoint)
	token, err := oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(entry.Verifier))
	if err != nil {
		failure(w, 401, "The provider did not complete sign-in.")
		return
	}
	id, err := s.verifiedIdentity(ctx, token, entry.Nonce, "")
	if err != nil || token.AccessToken == "" || token.RefreshToken == "" {
		failure(w, 401, "The provider identity and persistent grant could not be verified.")
		return
	}
	var claims struct{ Name, SID string }
	if err := id.Claims(&claims); err != nil {
		failure(w, 401, "Invalid identity claims.")
		return
	}
	raw, _ := token.Extra("id_token").(string)
	g := grant{ID: oauth2.GenerateVerifier(), Issuer: s.config.Issuer, Subject: id.Subject, SID: claims.SID,
		Name: claims.Name, Nonce: entry.Nonce, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, IDToken: raw,
		LoginStartedAt: entry.At, TokenExpiry: tokenDeadline(token, id), Expiry: time.Now().Add(s.config.Lifetime).Unix()}
	if err := s.introspect(ctx, g); err != nil {
		failure(w, 401, "The provider grant is no longer active. Start sign-in again.")
		return
	}
	g.CheckedAt = time.Now().UnixNano()
	if err := s.store.createGrant(g); err != nil {
		status := 500
		if errors.Is(err, errGrantRevoked) {
			status = 401
		}
		failure(w, status, "Could not establish an active identity grant.")
		return
	}
	if err := s.sessions.RenewToken(r.Context()); err != nil {
		s.store.deleteGrant(g.ID, g.Issuer)
		failure(w, 500, "Could not establish a session.")
		return
	}
	s.sessions.SetDeadline(r.Context(), time.Unix(g.Expiry, 0))
	s.sessions.Put(r.Context(), "grant_id", g.ID)
	http.Redirect(w, r, endpoint.app+"/", http.StatusFound)
}

func tokenDeadline(token *oauth2.Token, id *oidc.IDToken) int64 {
	if token.Expiry.IsZero() || id.Expiry.Before(token.Expiry) {
		return id.Expiry.Unix()
	}
	return token.Expiry.Unix()
}

func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	endpoint, _ := s.browserEndpoint(r)
	g, err := s.store.findGrant(s.sessions.GetString(r.Context(), "grant_id"), s.config.Issuer)
	if err == nil {
		resource := authorization.ResourceFor(s.config.Issuer, g.Subject)
		if expected := r.Header.Get(ResourceHeader); expected != "" && expected != resource.ID {
			w.Header().Set(ResourceHeader, resource.ID)
			WriteResourceChanged(w)
			return
		}
	}
	if err != nil || s.store.deleteGrant(g.ID, s.config.Issuer) != nil || s.sessions.Destroy(r.Context()) != nil {
		failure(w, 500, "Could not end the session.")
		return
	}
	destination := endpoint.app + "/"
	if s.logoutEndpoint != "" && g.IDToken != "" {
		u, err := url.Parse(s.browserProviderURL(s.logoutEndpoint, endpoint))
		if err == nil {
			q := u.Query()
			q.Set("id_token_hint", g.IDToken)
			q.Set("post_logout_redirect_uri", destination)
			q.Set("client_id", s.config.ClientID)
			u.RawQuery = q.Encode()
			destination = u.String()
		}
	}
	respond(w, authcontract.LogoutResponse{LogoutURL: destination})
}
