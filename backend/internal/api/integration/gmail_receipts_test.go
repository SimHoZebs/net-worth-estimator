package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type gmailScanFakeFetcher struct {
	ids       []string
	messages  map[string]gmail.Message
	historyID string
}

func (f *gmailScanFakeFetcher) ListRecent(_ context.Context, _ string, _ time.Time, _ string) (gmail.MessagePage, error) {
	return gmail.MessagePage{IDs: f.ids, LatestHistoryID: f.historyID}, nil
}

func (f *gmailScanFakeFetcher) ListSince(_ context.Context, _ string, _ string, _ string) (gmail.MessagePage, error) {
	return gmail.MessagePage{IDs: f.ids, LatestHistoryID: f.historyID}, nil
}

func (f *gmailScanFakeFetcher) GetMessage(_ context.Context, _ string, id string) (gmail.Message, error) {
	return f.messages[id], nil
}

func connectGmailForScan(t *testing.T, handler http.Handler) {
	t.Helper()
	authResponse := httptest.NewRecorder()
	handler.ServeHTTP(authResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/auth-url", nil))
	if authResponse.Code != http.StatusOK {
		t.Fatalf("auth-url status = %d", authResponse.Code)
	}
	var authPayload struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(authResponse.Body.Bytes(), &authPayload); err != nil {
		t.Fatalf("decode auth url: %v", err)
	}
	parsed, err := url.Parse(authPayload.URL)
	if err != nil {
		t.Fatalf("parse auth url: %v", err)
	}
	callback := httptest.NewRecorder()
	handler.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/callback?code=auth-code&state="+parsed.Query().Get("state"), nil))
	if callback.Code != http.StatusFound {
		t.Fatalf("callback status = %d, want 302", callback.Code)
	}
}

func scanGmail(t *testing.T, handler http.Handler) (int, gmail.ScanSummary) {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/integrations/gmail/scan", nil))
	var summary gmail.ScanSummary
	if response.Code == http.StatusOK {
		if err := json.Unmarshal(response.Body.Bytes(), &summary); err != nil {
			t.Fatalf("decode scan summary: %v", err)
		}
	}
	return response.Code, summary
}

func TestGmailScanExtractsListAndReview(t *testing.T) {
	transport := &gmailFakeTransport{}
	service := newGmailTestService(transport)
	service.Fetcher = &gmailScanFakeFetcher{
		ids: []string{"receipt-1", "ship-1"},
		messages: map[string]gmail.Message{
			"receipt-1": {
				ID: "receipt-1", From: "Example Store <receipts@example.com>",
				Subject: "Your order confirmation",
				Date:    time.Date(2026, 10, 20, 15, 4, 5, 0, time.UTC),
				Body:    "Order number: AB-12345\nOrder total: $42.50\n",
			},
			"ship-1": {
				ID: "ship-1", From: "Example Store <shipping@example.com>",
				Subject: "Your package has shipped",
				Date:    time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC),
				Body:    "Tracking number 1Z999. On its way!",
			},
		},
		historyID: "history-10",
	}
	handler := New(openAPIStore(t), Config{GmailService: service, GmailFrontendBaseURL: "https://app.example"})
	connectGmailForScan(t, handler)

	code, summary := scanGmail(t, handler)
	if code != http.StatusOK {
		t.Fatalf("scan status = %d", code)
	}
	if summary.Receipts != 1 || summary.Triaged != 2 || summary.Failed != 0 {
		t.Fatalf("summary = %+v, want 1 receipt of 2 triaged", summary)
	}

	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/receipts?verdict=receipt,refund", nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, body %s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Receipts []store.EmailReceipt `json:"receipts"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode receipts: %v", err)
	}
	if len(listed.Receipts) != 1 || listed.Receipts[0].Merchant != "Example Store" {
		t.Fatalf("receipts = %+v, want 1 extracted receipt", listed.Receipts)
	}
	if listed.Receipts[0].Provenance.Producer == "" {
		t.Fatalf("receipts = %+v, want source provenance", listed.Receipts)
	}

	reviewBody := bytes.NewReader([]byte(`{"correction":{"reference":"AB-12345-CORRECTED"}}`))
	reviewRequest := httptest.NewRequest(http.MethodPatch, "/v1/integrations/gmail/receipts/"+listed.Receipts[0].ID, reviewBody)
	reviewRequest.Header.Set("Content-Type", "application/json")
	reviewResponse := httptest.NewRecorder()
	handler.ServeHTTP(reviewResponse, reviewRequest)
	if reviewResponse.Code != http.StatusOK {
		t.Fatalf("review status = %d, body %s", reviewResponse.Code, reviewResponse.Body.String())
	}
	var reviewed struct {
		Receipt store.EmailReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(reviewResponse.Body.Bytes(), &reviewed); err != nil {
		t.Fatalf("decode review: %v", err)
	}
	if reviewed.Receipt.Status != store.EmailReceiptStatusConfirmed {
		t.Fatalf("receipt = %+v, want confirmed", reviewed.Receipt)
	}
	if reviewed.Receipt.Correction == nil || reviewed.Receipt.Correction.Reference != "AB-12345-CORRECTED" {
		t.Fatalf("receipt = %+v, want correction overlay", reviewed.Receipt)
	}
	if reviewed.Receipt.Reference != "AB-12345" {
		t.Fatalf("receipt = %+v, want original extraction preserved", reviewed.Receipt)
	}

	// Repeat scans dedupe: the second scan skips every message.
	if code, summary := scanGmail(t, handler); code != http.StatusOK || summary.Skipped != 2 || summary.Triaged != 0 {
		t.Fatalf("rescan = %d %+v, want 2 skipped", code, summary)
	}
}

func TestGmailScanNeedsConnection(t *testing.T) {
	transport := &gmailFakeTransport{}
	handler := New(openAPIStore(t), Config{GmailService: newGmailTestService(transport), GmailFrontendBaseURL: "https://app.example"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/integrations/gmail/scan", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("scan status = %d, want 400 before connect", response.Code)
	}
}

func TestGmailScanNeedsConfiguration(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/integrations/gmail/scan", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("scan status = %d, want 503", response.Code)
	}
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/receipts", nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200 without configuration", listResponse.Code)
	}
}

func TestGmailReceiptReviewNotFound(t *testing.T) {
	transport := &gmailFakeTransport{}
	handler := New(openAPIStore(t), Config{GmailService: newGmailTestService(transport), GmailFrontendBaseURL: "https://app.example"})
	request := httptest.NewRequest(http.MethodPatch, "/v1/integrations/gmail/receipts/missing", bytes.NewReader([]byte(`{}`)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("review status = %d, want 404", response.Code)
	}
}

func TestGmailScanAndReviewForbiddenInReadOnlyMode(t *testing.T) {
	transport := &gmailFakeTransport{}
	handler := New(openAPIStore(t), Config{GmailService: newGmailTestService(transport), GmailFrontendBaseURL: "https://app.example", ReadOnly: true})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/integrations/gmail/scan", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("scan status = %d, want 403", response.Code)
	}
	review := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/integrations/gmail/receipts/whatever", bytes.NewReader([]byte(`{}`)))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(review, request)
	if review.Code != http.StatusForbidden {
		t.Fatalf("review status = %d, want 403", review.Code)
	}
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/receipts", nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200 in read-only mode", listResponse.Code)
	}
}
