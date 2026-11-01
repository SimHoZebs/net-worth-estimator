package gmail

import (
	"context"
	"errors"
	"net/http"
	"strings"

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
	huma.Register(api, huma.Operation{
		OperationID: "scan-gmail-receipts",
		Method:      "POST",
		Path:        "/scan",
		Summary:     "Scan Gmail for purchase and refund receipts",
	}, s.scan)
	huma.Register(api, huma.Operation{
		OperationID: "list-gmail-receipts",
		Method:      "GET",
		Path:        "/receipts",
		Summary:     "Read extracted Gmail receipt evidence",
	}, s.listReceipts)
	huma.Register(api, huma.Operation{
		OperationID: "review-gmail-receipt",
		Method:      "PATCH",
		Path:        "/receipts/{id}",
		Summary:     "Confirm or correct one extracted Gmail receipt",
	}, s.reviewReceipt)
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

type gmailScanOutput struct {
	Body gmailservice.ScanSummary
}

// scan runs receipt discovery with the INT-02 token and cursor: the
// service refreshes the access token server-side, lists the initial or
// incremental window, triages each unseen message, and advances the
// history cursor. Per-message failures are isolated in the summary;
// only listing, cursor, and grant failures fail the request.
func (s *handler) scan(ctx context.Context, _ *struct{}) (*gmailScanOutput, error) {
	service, err := s.serviceOr503()
	if err != nil {
		return nil, err
	}
	summary, err := service.Scan(ctx, s.store)
	if err != nil {
		switch {
		case errors.Is(err, gmailservice.ErrNotConnected):
			return nil, huma.Error400BadRequest("Gmail is not connected")
		default:
			return nil, huma.Error500InternalServerError("The Gmail scan failed")
		}
	}
	return &gmailScanOutput{Body: summary}, nil
}

type gmailReceiptsInput struct {
	Verdict string `query:"verdict" maxLength:"200" doc:"Comma-separated verdicts: receipt, refund, shipping-only, ordinary, failed"`
	Status  string `query:"status" maxLength:"200" doc:"Comma-separated statuses: ready, needs-review, confirmed"`
	Cursor  string `query:"cursor" maxLength:"100"`
	Limit   int    `query:"limit" default:"50" minimum:"1" maximum:"100"`
}

type gmailReceiptsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Receipts   []store.EmailReceipt `json:"receipts"`
		NextCursor string               `json:"nextCursor"`
	}
}

func splitFilter(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := []string{}
	for _, part := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}

func (s *handler) listReceipts(_ context.Context, input *gmailReceiptsInput) (*gmailReceiptsOutput, error) {
	filter := store.EmailReceiptFilter{
		Verdict: splitFilter(input.Verdict),
		Status:  splitFilter(input.Status),
		Cursor:  input.Cursor,
		Limit:   input.Limit + 1,
	}
	for _, verdict := range filter.Verdict {
		switch verdict {
		case store.EmailReceiptVerdictReceipt, store.EmailReceiptVerdictRefund,
			store.EmailReceiptVerdictShipping, store.EmailReceiptVerdictOrdinary,
			store.EmailReceiptVerdictFailed:
		default:
			return nil, huma.Error422UnprocessableEntity("Unknown receipt verdict")
		}
	}
	for _, status := range filter.Status {
		switch status {
		case store.EmailReceiptStatusReady, store.EmailReceiptStatusNeedsReview, store.EmailReceiptStatusConfirmed:
		default:
			return nil, huma.Error422UnprocessableEntity("Unknown receipt status")
		}
	}
	items, err := s.store.ListEmailReceipts(filter)
	if err != nil {
		return nil, huma.Error500InternalServerError("Gmail receipts are temporarily unavailable")
	}
	output := &gmailReceiptsOutput{CacheControl: "private, no-store"}
	output.Body.Receipts = []store.EmailReceipt{}
	if len(items) > input.Limit {
		items = items[:input.Limit]
		output.Body.NextCursor = items[len(items)-1].ID
	}
	output.Body.Receipts = append(output.Body.Receipts, items...)
	return output, nil
}

type gmailReviewInput struct {
	ID   string `path:"id" maxLength:"100"`
	Body struct {
		// Correction overlays the original extraction; null confirms the
		// extraction as-is. The original values stay preserved.
		Correction *store.EmailReceiptCorrection `json:"correction,omitempty"`
	}
}

type gmailReceiptOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Receipt store.EmailReceipt `json:"receipt"`
	}
}

// reviewReceipt confirms or corrects one extraction. The correction
// overlays the original values and marks the row confirmed; the
// original extraction and provenance are preserved for INT-04 matching.
func (s *handler) reviewReceipt(_ context.Context, input *gmailReviewInput) (*gmailReceiptOutput, error) {
	receipt, err := s.store.ReviewEmailReceipt(input.ID, input.Body.Correction)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, huma.Error404NotFound("Gmail receipt not found")
		}
		return nil, huma.Error500InternalServerError("The Gmail receipt could not be reviewed")
	}
	output := &gmailReceiptOutput{CacheControl: "private, no-store"}
	output.Body.Receipt = receipt
	return output, nil
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
