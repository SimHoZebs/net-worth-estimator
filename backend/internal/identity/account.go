// Package identity owns provider-independent OIDC login and application sessions.
//
// account.go adds a purely presentational self-service layer. All account
// rules stay in Casdoor: password complexity, history, lockout, profile
// validation, and token revocation. The backend only verifies the app session,
// derives the caller's owner and name from Casdoor itself, forwards the request
// as the user with their own access token, and passes the result through.
// Application sessions are the exception: those rows live in this service, so
// listing and revoking other app grants stays local.
package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
)

// errAccountRevoked marks a Casdoor answer that ends the local session: the
// token is reported inactive, belongs to another subject, or resolves to no
// usable identity. Transport and decode failures stay separate 503s so the UI
// does not invite re-login for a transient outage.
var errAccountRevoked = errors.New("provider account is no longer active")

type casdoorAccount = authcontract.AccountProfile

func (s *Service) currentGrant(r *http.Request) (grant, string, error) {
	id := s.sessions.GetString(r.Context(), "grant_id")
	if id == "" {
		return grant{}, "", nil
	}
	g, err := s.validateGrant(r.Context(), id)
	if err != nil {
		return grant{}, "", err
	}
	if g.ID == "" {
		return grant{}, "", nil
	}
	return g, id, nil
}

func (s *Service) casdoorUserCall(ctx context.Context, g grant, method, apiPath string, body io.Reader, contentType string) (*http.Response, error) {
	target := strings.TrimRight(s.config.Issuer, "/") + apiPath
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+g.AccessToken)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	// s.client routes the public issuer host over the private transport when
	// InternalURL is configured, without changing the public issuer or Host.
	return s.client.Do(req)
}

func decodeCasdoorResponse(resp *http.Response) (map[string]any, error) {
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// resolveSelf asks Casdoor who the access token belongs to and binds it to the
// local grant subject. Owner and name never come from the request body.
func (s *Service) resolveSelf(r *http.Request, g grant) (casdoorAccount, error) {
	resp, err := s.casdoorUserCall(r.Context(), g, http.MethodGet, "/api/get-account", nil, "")
	if err != nil {
		return casdoorAccount{}, err
	}
	body, err := decodeCasdoorResponse(resp)
	if err != nil {
		return casdoorAccount{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return casdoorAccount{}, fmt.Errorf("account service returned status %d", resp.StatusCode)
	}
	if status, _ := body["status"].(string); status != "ok" {
		return casdoorAccount{}, errAccountRevoked
	}
	sub, _ := body["sub"].(string)
	if sub == "" || sub != g.Subject {
		return casdoorAccount{}, errAccountRevoked
	}
	data, _ := body["data"].(map[string]any)
	account := casdoorAccount{
		Owner:       stringValue(data, "owner"),
		Name:        stringValue(data, "name"),
		DisplayName: stringValue(data, "displayName"),
		Avatar:      stringValue(data, "avatar"),
	}
	if account.Owner == "" || account.Name == "" {
		return casdoorAccount{}, errAccountRevoked
	}
	return account, nil
}

// revoked ends the local session when Casdoor reports the account gone.
// Transport errors stay 503s; only revoked semantics force re-login.
func (s *Service) revoked(w http.ResponseWriter, r *http.Request, g grant) {
	_ = s.store.deleteGrant(g.ID, s.config.Issuer)
	_ = s.sessions.Destroy(r.Context())
	failure(w, 401, "The account is no longer active. Start sign-in again.")
}

func stringValue(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	value, _ := data[key].(string)
	return value
}

func (s *Service) accountProfile(w http.ResponseWriter, r *http.Request) {
	g, _, err := s.currentGrant(r)
	if err != nil {
		failure(w, 503, "Identity verification is temporarily unavailable.")
		return
	}
	if g.ID == "" {
		failure(w, 401, "Sign in to manage your account.")
		return
	}
	account, err := s.resolveSelf(r, g)
	if err != nil {
		if errors.Is(err, errAccountRevoked) {
			s.revoked(w, r, g)
			return
		}
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	respond(w, account)
}

func (s *Service) accountUpdateProfile(w http.ResponseWriter, r *http.Request) {
	g, _, err := s.currentGrant(r)
	if err != nil {
		failure(w, 503, "Identity verification is temporarily unavailable.")
		return
	}
	if g.ID == "" {
		failure(w, 401, "Sign in to manage your account.")
		return
	}
	var input authcontract.AccountProfileUpdate
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		failure(w, 400, "The account update is invalid.")
		return
	}
	if input.DisplayName == nil && input.Avatar == nil {
		failure(w, 400, "Nothing to update. Provide a display name or avatar.")
		return
	}
	account, err := s.resolveSelf(r, g)
	if err != nil {
		if errors.Is(err, errAccountRevoked) {
			s.revoked(w, r, g)
			return
		}
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	update := map[string]any{}
	columns := []string{}
	if input.DisplayName != nil {
		// Trimming and the request size bound are transport hygiene. Length,
		// character, and uniqueness rules stay in Casdoor, which rejects with
		// its own message passed through below.
		update["displayName"] = strings.TrimSpace(*input.DisplayName)
		columns = append(columns, "displayName")
	}
	if input.Avatar != nil {
		update["avatar"] = strings.TrimSpace(*input.Avatar)
		columns = append(columns, "avatar")
	}
	payload, _ := json.Marshal(update)
	target := "/api/update-user?id=" + url.QueryEscape(account.Owner+"/"+account.Name) + "&columns=" + url.QueryEscape(strings.Join(columns, ","))
	resp, err := s.casdoorUserCall(r.Context(), g, http.MethodPost, target, strings.NewReader(string(payload)), "application/json")
	if err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	body, err := decodeCasdoorResponse(resp)
	if err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	if resp.StatusCode != http.StatusOK {
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	if status, _ := body["status"].(string); status != "ok" {
		msg, _ := body["msg"].(string)
		if msg == "" {
			msg = "The account update was rejected."
		}
		failure(w, 400, msg)
		return
	}
	s.accountProfile(w, r)
}

func (s *Service) accountChangePassword(w http.ResponseWriter, r *http.Request) {
	g, _, err := s.currentGrant(r)
	if err != nil {
		failure(w, 503, "Identity verification is temporarily unavailable.")
		return
	}
	if g.ID == "" {
		failure(w, 401, "Sign in to manage your account.")
		return
	}
	var input authcontract.AccountPasswordChange
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil || input.OldPassword == "" || input.NewPassword == "" {
		failure(w, 400, "Provide the current and a new password.")
		return
	}
	account, err := s.resolveSelf(r, g)
	if err != nil {
		if errors.Is(err, errAccountRevoked) {
			s.revoked(w, r, g)
			return
		}
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	form := url.Values{"userOwner": {account.Owner}, "userName": {account.Name}, "oldPassword": {input.OldPassword}, "newPassword": {input.NewPassword}}
	resp, err := s.casdoorUserCall(r.Context(), g, http.MethodPost, "/api/set-password", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	body, err := decodeCasdoorResponse(resp)
	if err != nil {
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	if resp.StatusCode != http.StatusOK {
		failure(w, 503, "The account service is temporarily unavailable.")
		return
	}
	if status, _ := body["status"].(string); status != "ok" {
		msg, _ := body["msg"].(string)
		if msg == "" {
			msg = "The password change was rejected."
		}
		failure(w, 400, msg)
		return
	}
	// Casdoor expires the changed user's tokens. Drop every local grant for
	// the subject so all devices sign out at once, then end this app session
	// so the caller signs in again with the new password.
	_ = s.store.deleteSubjectGrants(g.Issuer, g.Subject)
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
	grants, err := s.store.listGrants(s.config.Issuer, g.Subject)
	if err != nil {
		failure(w, 503, "The session list is temporarily unavailable.")
		return
	}
	items := make([]authcontract.AccountSession, 0, len(grants))
	for _, item := range grants {
		items = append(items, authcontract.AccountSession{
			ID:             item.ID,
			Current:        item.ID == id,
			LoginStartedAt: time.Unix(0, item.LoginStartedAt).UTC().Format(time.RFC3339),
			ExpiresAt:      time.Unix(item.Expiry, 0).UTC().Format(time.RFC3339),
		})
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
	victim, err := s.store.findGrant(target, s.config.Issuer)
	if err != nil || victim.ID == "" || victim.Subject != g.Subject {
		failure(w, 404, "That session was not found.")
		return
	}
	if err := s.store.deleteGrant(target, s.config.Issuer); err != nil {
		failure(w, 503, "The session list is temporarily unavailable.")
		return
	}
	respond(w, authcontract.AccountSessionRevoked{Revoked: true})
}
