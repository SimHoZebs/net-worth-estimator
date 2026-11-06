package identity

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

var errAccountRevoked = errors.New("provider account is no longer active")

func (s *Service) currentGrant(r *http.Request) (store.Grant, string, error) {
	id := s.sessions.GetString(r.Context(), "grant_id")
	if id == "" {
		return store.Grant{}, "", nil
	}
	g, err := s.validateGrant(r.Context(), id)
	return g, id, err
}

func (s *Service) revoked(w http.ResponseWriter, r *http.Request, g store.Grant) {
	_ = s.store.DeleteGrant(g.ID, s.config.Issuer)
	_ = s.store.RemoveGroupMemberships(s.config.Issuer, g.Subject)
	_ = s.sessions.Destroy(r.Context())
	failure(w, 401, "The account is no longer active. Start sign-in again.")
}

// Provider account operations bind the OAuth token to its immutable subject.
// Better Auth owns credential validation and provider-session revocation.
func (s *Service) accountCall(w http.ResponseWriter, r *http.Request, method, path string, input any) (map[string]json.RawMessage, store.Grant, bool) {
	g, _, err := s.currentGrant(r)
	if err != nil {
		failure(w, 503, "Identity verification is temporarily unavailable.")
		return nil, g, false
	}
	if g.ID == "" {
		failure(w, 401, "Sign in to manage your account.")
		return nil, g, false
	}
	var body io.Reader
	if input != nil {
		raw, _ := json.Marshal(input)
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, strings.TrimRight(s.config.Issuer, "/")+"/waypoint/account"+path, body)
	if err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return nil, g, false
	}
	req.Header.Set("Authorization", "Bearer "+g.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return nil, g, false
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		s.revoked(w, r, g)
		return nil, g, false
	}
	var out map[string]json.RawMessage
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return nil, g, false
	}
	if resp.StatusCode == 400 {
		var message string
		_ = json.Unmarshal(out["error"], &message)
		if message == "" {
			message = "The account update was rejected."
		}
		failure(w, 400, message)
		return nil, g, false
	}
	if resp.StatusCode != 200 {
		failure(w, 503, "The account service is temporarily unavailable.")
		return nil, g, false
	}
	if path != "/password" {
		var subject string
		_ = json.Unmarshal(out["subject"], &subject)
		if subject != g.Subject {
			s.revoked(w, r, g)
			return nil, g, false
		}
	}
	return out, g, true
}

func (s *Service) accountProfile(w http.ResponseWriter, r *http.Request) {
	out, _, ok := s.accountCall(w, r, http.MethodGet, "", nil)
	if ok {
		respond(w, out)
	}
}

func (s *Service) accountUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var input authcontract.AccountProfileUpdate
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		failure(w, 400, "The account update is invalid.")
		return
	}
	if input.DisplayName == nil && input.Avatar == nil {
		failure(w, 400, "Nothing to update. Provide a display name or avatar.")
		return
	}
	out, _, ok := s.accountCall(w, r, http.MethodPost, "", input)
	if ok {
		respond(w, out)
	}
}

func (s *Service) accountChangePassword(w http.ResponseWriter, r *http.Request) {
	var input authcontract.AccountPasswordChange
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil || input.OldPassword == "" || input.NewPassword == "" {
		failure(w, 400, "Provide the current and a new password.")
		return
	}
	_, g, ok := s.accountCall(w, r, http.MethodPost, "/password", input)
	if !ok {
		return
	}
	if err := s.store.DeleteSubjectGrants(g.Issuer, g.Subject); err != nil {
		failure(w, 503, "Could not end account sessions.")
		return
	}
	_ = s.sessions.Destroy(r.Context())
	respond(w, authcontract.AccountPasswordChanged{Reauth: true})
}

func (s *Service) accountSessions(w http.ResponseWriter, r *http.Request) {
	g, id, err := s.currentGrant(r)
	if err != nil {
		failure(w, 503, "Identity verification is temporarily unavailable.")
		return
	}
	if g.ID == "" {
		failure(w, 401, "Sign in to manage your account.")
		return
	}
	grants, err := s.store.ListGrants(s.config.Issuer, g.Subject)
	if err != nil {
		failure(w, 503, "The session list is temporarily unavailable.")
		return
	}
	items := make([]authcontract.AccountSession, 0, len(grants))
	for _, item := range grants {
		items = append(items, authcontract.AccountSession{ID: item.ID, Current: item.ID == id, LoginStartedAt: time.Unix(0, item.LoginStartedAt).UTC().Format(time.RFC3339), ExpiresAt: time.Unix(item.Expiry, 0).UTC().Format(time.RFC3339)})
	}
	respond(w, authcontract.AccountSessions{Sessions: items})
}

func (s *Service) accountRevokeSession(w http.ResponseWriter, r *http.Request) {
	g, id, err := s.currentGrant(r)
	if err != nil {
		failure(w, 503, "Identity verification is temporarily unavailable.")
		return
	}
	if g.ID == "" {
		failure(w, 401, "Sign in to manage your account.")
		return
	}
	target := r.URL.Query().Get("id")
	if target == "" {
		failure(w, 400, "Choose a session to revoke.")
		return
	}
	if target == id {
		failure(w, 400, "Sign out instead of revoking the current session.")
		return
	}
	victim, err := s.store.FindGrant(target, s.config.Issuer)
	if err != nil || victim.ID == "" || victim.Subject != g.Subject {
		failure(w, 404, "That session was not found.")
		return
	}
	if err := s.store.DeleteGrant(target, s.config.Issuer); err != nil {
		failure(w, 503, "The session list is temporarily unavailable.")
		return
	}
	respond(w, authcontract.AccountSessionRevoked{Revoked: true})
}
