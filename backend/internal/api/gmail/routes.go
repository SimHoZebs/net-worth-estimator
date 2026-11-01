package gmail

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	gmailservice "github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type handler struct {
	store    store.Store
	service  *gmailservice.Service
	readOnly bool
}

// Register adds the Gmail connection endpoints under the provider's own
// path. The provider-neutral GET /v1/integrations listing only snapshots
// display-safe status; connect, callback, lookback, and disconnect live
// here. Payloads never carry tokens. Consent issuance stores CSRF state,
// so it honors read-only mode like any other write even though it is a
// GET; the same holds for the raw callback route.
func Register(api huma.API, st store.Store, service *gmailservice.Service, readOnly bool) {
	s := &handler{store: st, service: service, readOnly: readOnly}
	api = huma.NewGroup(api, "/v1/integrations/gmail")
	huma.Register(api, huma.Operation{
		OperationID: "get-gmail-credential",
		Method:      "GET",
		Path:        "/credential",
		Summary:     "Report Gmail connection state (never secrets)",
	}, s.getCredential)
	huma.Register(api, huma.Operation{
		OperationID: "get-gmail-auth-url",
		Method:      "GET",
		Path:        "/auth-url",
		Summary:     "Start Gmail consent with the read-only scope",
	}, s.getAuthURL)
	huma.Register(api, huma.Operation{
		OperationID: "disconnect-gmail-credential",
		Method:      "DELETE",
		Path:        "/credential",
		Summary:     "Revoke and forget the Gmail grant",
	}, s.disconnect)
	huma.Register(api, huma.Operation{
		OperationID: "set-gmail-lookback",
		Method:      "PUT",
		Path:        "/lookback",
		Summary:     "Set the Gmail initial scan lookback in days",
	}, s.setLookback)
}

type gmailCredentialBody struct {
	Connected bool `json:"connected"`
	// EmailAddress is the consented account for display. Never a secret.
	EmailAddress string `json:"emailAddress,omitempty"`
	// ConnectedAt is the RFC3339 connection time, omitted when disconnected.
	ConnectedAt string `json:"connectedAt,omitempty"`
	// Scopes records the granted OAuth scopes for consent audit.
	Scopes string `json:"scopes,omitempty"`
	// LookbackDays is the configurable initial scan window.
	LookbackDays int `json:"lookbackDays"`
	// LastScanAt is the last successful scan completion time (RFC3339
	// UTC), omitted until the first scan completes (INT-03).
	LastScanAt string `json:"lastScanAt,omitempty"`
}

type gmailCredentialOutput struct {
	Body gmailCredentialBody
}

type gmailAuthURLOutput struct {
	Body struct {
		URL string `json:"url"`
	}
}

type gmailLookbackInput struct {
	Body struct {
		LookbackDays int `json:"lookbackDays"`
	}
}

func credentialBody(credential store.GmailCredential) gmailCredentialBody {
	body := gmailCredentialBody{Connected: credential.Connected(), LookbackDays: credential.LookbackDays}
	if body.Connected {
		body.EmailAddress = credential.EmailAddress
		body.ConnectedAt = credential.ConnectedAt
		body.Scopes = credential.Scopes
		body.LastScanAt = credential.LastScanAt
	}
	return body
}

func (s *handler) serviceOr503() (*gmailservice.Service, error) {
	if s.service == nil || !s.service.Configured() {
		return nil, huma.Error503ServiceUnavailable("gmail is not configured")
	}
	return s.service, nil
}

func (s *handler) getCredential(_ context.Context, _ *struct{}) (*gmailCredentialOutput, error) {
	credential, err := s.store.GetGmailCredential()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &gmailCredentialOutput{Body: credentialBody(credential)}, nil
}

func (s *handler) getAuthURL(ctx context.Context, _ *struct{}) (*gmailAuthURLOutput, error) {
	if s.readOnly {
		return nil, huma.Error403Forbidden("server is read-only")
	}
	service, err := s.serviceOr503()
	if err != nil {
		return nil, err
	}
	raw, err := service.AuthURL(ctx, s.store)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output := &gmailAuthURLOutput{}
	output.Body.URL = raw
	return output, nil
}

// disconnect revokes the grant at Google best-effort and forgets the
// user's tokens, account, and scan cursor.
func (s *handler) disconnect(ctx context.Context, _ *struct{}) (*gmailCredentialOutput, error) {
	service, err := s.serviceOr503()
	if err != nil {
		return nil, err
	}
	if err := service.Disconnect(ctx, s.store); err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	credential, err := s.store.GetGmailCredential()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &gmailCredentialOutput{Body: credentialBody(credential)}, nil
}

func (s *handler) setLookback(ctx context.Context, input *gmailLookbackInput) (*gmailCredentialOutput, error) {
	service, err := s.serviceOr503()
	if err != nil {
		return nil, err
	}
	credential, err := service.SetLookback(ctx, s.store, input.Body.LookbackDays)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	return &gmailCredentialOutput{Body: credentialBody(credential)}, nil
}

// CallbackHandler serves the Google OAuth redirect as a plain chi route:
// Google issues a GET with code and state, and the browser must land back
// on the frontend with the outcome. It is described in the OpenAPI
// document next to the other non-Huma routes. State mismatch, missing
// code, and exchange failures all land on the frontend error flag without
// exposing details or secrets. Read-only mode rejects the grant write
// with 403, matching the middleware-guarded endpoints.
func CallbackHandler(service *gmailservice.Service, st store.Store, frontendBaseURL string, readOnly bool) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		if readOnly {
			http.Error(writer, "server is read-only", http.StatusForbidden)
			return
		}
		target := frontendBaseURL + "?gmail=error"
		if service != nil && service.Configured() {
			if _, err := service.Callback(request.Context(), st, request.URL.Query().Get("code"), request.URL.Query().Get("state")); err == nil {
				target = frontendBaseURL + "?gmail=connected"
			}
		}
		http.Redirect(writer, request, target, http.StatusFound)
	}
}
