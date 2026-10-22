package identity

import (
	"encoding/json"
	"mime"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

const logoutEvent = "http://schemas.openid.net/event/backchannel-logout"

func (s *Service) backchannelLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		failure(w, http.StatusMethodNotAllowed, "Logout notifications require POST.")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/x-www-form-urlencoded" {
		failure(w, 400, "Expected a form-encoded logout notification.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	if r.ParseForm() != nil || len(r.PostForm["logout_token"]) != 1 || r.PostForm.Get("logout_token") == "" {
		failure(w, 400, "Invalid logout notification.")
		return
	}
	// OIDC logout tokens require iat, not exp. Casdoor omits exp. The OIDC
	// library verifies signature, issuer, and audience. Bound iat and any
	// supplied exp separately, without weakening normal ID-token verification.
	identity, err := s.provider.Verifier(&oidc.Config{ClientID: s.config.ClientID, SkipExpiryCheck: true}).Verify(
		oidc.ClientContext(r.Context(), s.client), r.PostForm.Get("logout_token"))
	if err != nil {
		failure(w, 400, "The logout token could not be verified.")
		return
	}
	var claims struct {
		SID    string                     `json:"sid"`
		JTI    string                     `json:"jti"`
		Events map[string]json.RawMessage `json:"events"`
	}
	var raw map[string]json.RawMessage
	if identity.Claims(&claims) != nil || identity.Claims(&raw) != nil {
		failure(w, 400, "Invalid logout claims.")
		return
	}
	now := time.Now()
	_, hasNonce := raw["nonce"]
	_, hasExpiry := raw["exp"]
	var event map[string]json.RawMessage
	validEvent := json.Unmarshal(claims.Events[logoutEvent], &event) == nil && event != nil && len(event) == 0
	if !validEvent || hasNonce || claims.JTI == "" || len(claims.JTI) > 256 || (identity.Subject == "" && claims.SID == "") ||
		identity.IssuedAt.Before(now.Add(-2*time.Minute)) || identity.IssuedAt.After(now.Add(30*time.Second)) ||
		(hasExpiry && !identity.Expiry.After(now)) {
		failure(w, 400, "Invalid or expired logout claims.")
		return
	}
	if err := s.store.revokeGrants(s.config.Issuer, identity.Subject, claims.SID, claims.JTI, s.config.Lifetime); err != nil {
		failure(w, 500, "Could not apply the logout notification.")
		return
	}
	w.WriteHeader(http.StatusOK)
}
