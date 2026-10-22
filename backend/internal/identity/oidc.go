package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func (s *Service) login(w http.ResponseWriter, r *http.Request) {
	endpoint, _ := s.browserEndpoint(r)
	if s.sessions.GetString(r.Context(), "grant_id") == "" {
		s.sessions.SetDeadline(r.Context(), time.Now().Add(10*time.Minute))
	}
	state, nonce, verifier := oauth2.GenerateVerifier(), oauth2.GenerateVerifier(), oauth2.GenerateVerifier()
	s.sessions.Put(r.Context(), "state", state)
	s.sessions.Put(r.Context(), "nonce", nonce)
	s.sessions.Put(r.Context(), "verifier", verifier)
	s.sessions.Put(r.Context(), "login_at", time.Now().UnixNano())
	s.sessions.Put(r.Context(), "login_origin", endpoint.app)
	oauth := s.browserOAuth(endpoint)
	http.Redirect(w, r, oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), http.StatusFound)
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
	loginOrigin := s.sessions.PopString(r.Context(), "login_origin")
	state := s.sessions.PopString(r.Context(), "state")
	nonce := s.sessions.PopString(r.Context(), "nonce")
	verifier := s.sessions.PopString(r.Context(), "verifier")
	loginAt := s.sessions.GetInt64(r.Context(), "login_at")
	s.sessions.Remove(r.Context(), "login_at")
	started := time.Unix(0, loginAt)
	if loginOrigin != endpoint.app || state == "" || nonce == "" || verifier == "" || time.Since(started) > 10*time.Minute || started.After(time.Now().Add(30*time.Second)) || subtle.ConstantTimeCompare([]byte(state), []byte(r.URL.Query().Get("state"))) != 1 || r.URL.Query().Get("code") == "" {
		failure(w, 400, "The login expired or its state is invalid. Start sign-in again.")
		return
	}
	ctx := oidc.ClientContext(r.Context(), s.client)
	oauth := s.browserOAuth(endpoint)
	token, err := oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		failure(w, 401, "The provider did not complete sign-in.")
		return
	}
	id, err := s.verifiedIdentity(ctx, token, nonce, "")
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
		Name: claims.Name, Nonce: nonce, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, IDToken: raw,
		LoginStartedAt: loginAt, TokenExpiry: tokenDeadline(token, id), Expiry: time.Now().Add(s.config.Lifetime).Unix()}
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
			failure(w, 409, "The active plan changed. Reload the session before signing out.")
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
	respond(w, map[string]string{"logoutURL": destination})
}
