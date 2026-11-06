package integrationledger

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Completeness: the ledger's bookshop charge arrives as a mail receipt
// with its extracted values, confirms with a correction over the
// original, and an ambiguous second mail stays held for review. The
// image receipt attached to the charge confirms and links, and the link
// survives a bank re-sync. Mail reaches the suite through a fake fetcher
// at the provider boundary (no Google OAuth — that seam is named, and
// everything downstream is the production scan/storage/review path);
// image extraction uses the local stand-in (no OCR). Mail-to-charge
// matching has no product surface: the mail row and the charge row are
// each asserted present, and the gap is stated, never faked.

// ledgerMailFetcher serves fixed ledger mail at the provider boundary.
type ledgerMailFetcher struct {
	messages map[string]gmail.Message
	order    []string
}

func (f *ledgerMailFetcher) ListRecent(_ context.Context, _ string, _ time.Time, _ string) (gmail.MessagePage, error) {
	return gmail.MessagePage{IDs: f.order, LatestHistoryID: "ledger-history-1"}, nil
}

func (f *ledgerMailFetcher) ListSince(_ context.Context, _ string, _ string, _ string) (gmail.MessagePage, error) {
	return gmail.MessagePage{IDs: f.order, LatestHistoryID: "ledger-history-1"}, nil
}

func (f *ledgerMailFetcher) GetMessage(_ context.Context, _ string, id string) (gmail.Message, error) {
	return f.messages[id], nil
}

type ledgerTokenExchange struct{}

func (ledgerTokenExchange) ExchangeCode(_ context.Context, code string) (*oauth2.Token, error) {
	if code == "" {
		return nil, context.DeadlineExceeded
	}
	return &oauth2.Token{AccessToken: "ledger-access", RefreshToken: "ledger-refresh", Expiry: time.Now().Add(time.Hour)}, nil
}

func (ledgerTokenExchange) Refresh(_ context.Context, _ string) (*oauth2.Token, error) {
	return &oauth2.Token{AccessToken: "ledger-access", Expiry: time.Now().Add(time.Hour)}, nil
}

type ledgerProfileTransport struct{}

func (ledgerProfileTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	payload, _ := json.Marshal(map[string]string{"emailAddress": "ledger@example.com"})
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(payload)), Header: http.Header{}, Request: request}, nil
}

func ledgerGmailService(fetcher *ledgerMailFetcher) *gmail.Service {
	service := gmail.New(gmail.Config{
		ClientID: "ledger-client", ClientSecret: "ledger-secret",
		RedirectURL: "https://api.example/v1/integrations/gmail/callback", FrontendBaseURL: "https://app.example",
		Exchange: ledgerTokenExchange{}, HTTPClient: &http.Client{Transport: ledgerProfileTransport{}},
	})
	service.Fetcher = fetcher
	return service
}

func ledgerConnectGmail(t *testing.T, handler http.Handler) {
	t.Helper()
	authResponse := httptest.NewRecorder()
	handler.ServeHTTP(authResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/auth-url", nil))
	if authResponse.Code != http.StatusOK {
		t.Fatalf("auth-url = %d", authResponse.Code)
	}
	var authPayload struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(authResponse.Body.Bytes(), &authPayload); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(authPayload.URL)
	if err != nil {
		t.Fatal(err)
	}
	callback := httptest.NewRecorder()
	handler.ServeHTTP(callback, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/callback?code=ledger-code&state="+parsed.Query().Get("state"), nil))
	if callback.Code != http.StatusFound {
		t.Fatalf("callback = %d, want 302", callback.Code)
	}
}

func ledgerMailReceipts(t *testing.T, handler http.Handler, query string) []store.EmailReceipt {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/receipts"+query, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("mail list = %d %s", response.Code, response.Body.String())
	}
	var listed struct {
		Receipts []store.EmailReceipt `json:"receipts"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	return listed.Receipts
}

func TestLedgerMailReceiptShowsChargeEvidence(t *testing.T) {
	fetcher := &ledgerMailFetcher{
		order: []string{"ledger-mail-bookshop", "ledger-mail-vague"},
		messages: map[string]gmail.Message{
			"ledger-mail-bookshop": {
				ID: "ledger-mail-bookshop", From: "Bookshop <orders@bookshop.example>",
				Subject: "Your bookshop order confirmation",
				Date:    time.Date(2026, 1, 20, 15, 4, 5, 0, time.UTC),
				Body:    "Order number: LEDGER-4242\nOrder total: $42.50\nThank you for shopping with us.\n",
			},
			// Ambiguous: a receipt-shaped mail with no usable sender
			// and no date or reference stays held for review instead
			// of confirming itself.
			"ledger-mail-vague": {
				ID: "ledger-mail-vague", From: "",
				Subject: "Your order confirmation",
				Body:    "Order total: $18.25 charged today. Details to follow soon.",
			},
		},
	}
	world := ledgerSetup(t, ledgerGmailService(fetcher))
	ledgerDeletePhantom(t, world)
	ledgerConnectGmail(t, world.plan)

	scan := httptest.NewRecorder()
	world.plan.ServeHTTP(scan, httptest.NewRequest(http.MethodPost, "/v1/integrations/gmail/scan", nil))
	if scan.Code != http.StatusOK {
		t.Fatalf("scan = %d %s", scan.Code, scan.Body.String())
	}
	var summary gmail.ScanSummary
	if err := json.Unmarshal(scan.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Receipts < 1 || summary.Triaged != 2 {
		t.Fatalf("summary = %+v, want the bookshop receipt of 2 triaged", summary)
	}

	// The seeded mail rows list with their extracted values: the
	// bookshop row with reference and amount, the ambiguous row held
	// for review.
	receipts := ledgerMailReceipts(t, world.plan, "?verdict=receipt,refund")
	if len(receipts) != 2 {
		t.Fatalf("receipts = %d, want both seeded mails", len(receipts))
	}
	var bookshop *store.EmailReceipt
	for i := range receipts {
		if receipts[i].Reference == "LEDGER-4242" {
			bookshop = &receipts[i]
		}
	}
	if bookshop == nil {
		t.Fatalf("receipts = %+v, want the bookshop extraction", receipts)
	}
	receipt := *bookshop
	if receipt.AmountText == "" || receipt.Merchant == "" || receipt.Provenance.Producer == "" {
		t.Fatalf("receipt = %+v, want amount, merchant, and provenance", receipt)
	}
	// The ledger's bookshop charge lists beside it with the same amount.
	byName := ledgerTransactionIDs(t, world.ownerSC)
	if len(byName["Bookshop order"]) != 1 {
		t.Fatalf("bookshop charge rows = %d, want 1", len(byName["Bookshop order"]))
	}
	// No matcher links mail to charges in this product: both rows are
	// asserted present above, and the gap stays stated here.

	// Confirming with a correction overlays the reference while the
	// original extraction stays preserved.
	reviewReq := httptest.NewRequest(http.MethodPatch, "/v1/integrations/gmail/receipts/"+receipt.ID,
		strings.NewReader(`{"correction":{"reference":"LEDGER-4242-CORRECTED"}}`))
	reviewReq.Header.Set("Content-Type", "application/json")
	reviewResp := httptest.NewRecorder()
	world.plan.ServeHTTP(reviewResp, reviewReq)
	var reviewed struct {
		Receipt store.EmailReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(reviewResp.Body.Bytes(), &reviewed); err != nil || reviewed.Receipt.Status != store.EmailReceiptStatusConfirmed {
		t.Fatalf("review = %d %+v, want confirmed", reviewResp.Code, reviewed)
	}
	if reviewed.Receipt.Correction == nil || reviewed.Receipt.Correction.Reference != "LEDGER-4242-CORRECTED" || reviewed.Receipt.Reference != "LEDGER-4242" {
		t.Fatalf("receipt = %+v, want the correction over the original", reviewed.Receipt)
	}

	// The ambiguous mail is held for review, never auto-confirmed.
	all := ledgerMailReceipts(t, world.plan, "")
	ambiguous := false
	for _, item := range all {
		if item.GmailMessageID == "ledger-mail-vague" {
			ambiguous = true
			if item.Status != store.EmailReceiptStatusNeedsReview {
				t.Fatalf("ambiguous mail status = %q, want held for review", item.Status)
			}
		}
	}
	if !ambiguous {
		t.Fatalf("ambiguous mail missing from %d listed", len(all))
	}
}

func ledgerUploadImage(t *testing.T, handler http.Handler, transactionID string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	if err := form.WriteField("transactionId", transactionID); err != nil {
		t.Fatal(err)
	}
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="image"; filename="receipt.png"`},
		"Content-Type":        {"image/png"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(receiptmock.SampleImage); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/receipts", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", response.Code, response.Body.String())
	}
	return response
}

func TestLedgerImageReceiptLinksChargeAcrossResync(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	byName := ledgerTransactionIDs(t, world.ownerSC)
	charge := byName["Bookshop order"][0]

	upload := ledgerUploadImage(t, world.plan, charge)
	var attached struct {
		Receipt types.Receipt `json:"receipt"`
	}
	if err := json.Unmarshal(upload.Body.Bytes(), &attached); err != nil || attached.Receipt.ID == "" {
		t.Fatalf("attach = %d, want a receipt", upload.Code)
	}
	extractReq := httptest.NewRequest(http.MethodPost, "/v1/receipts/"+attached.Receipt.ID+"/extract", nil)
	extractResp := httptest.NewRecorder()
	world.plan.ServeHTTP(extractResp, extractReq)
	var extracted struct {
		Receipt types.Receipt `json:"receipt"`
	}
	if err := json.Unmarshal(extractResp.Body.Bytes(), &extracted); err != nil || extracted.Receipt.Extraction == nil {
		t.Fatalf("extract = %d (harness adapter), want evidence", extractResp.Code)
	}
	details := extracted.Receipt.Extraction.Details
	details.Merchant = "Bookshop"
	reviewBody, _ := json.Marshal(map[string]any{"revision": extracted.Receipt.Revision, "details": details, "confirm": true})
	reviewReq := httptest.NewRequest(http.MethodPatch, "/v1/receipts/"+attached.Receipt.ID, bytes.NewReader(reviewBody))
	reviewReq.Header.Set("Content-Type", "application/json")
	reviewResp := httptest.NewRecorder()
	world.plan.ServeHTTP(reviewResp, reviewReq)
	if reviewResp.Code != http.StatusOK {
		t.Fatalf("confirm = %d %s", reviewResp.Code, reviewResp.Body.String())
	}

	// The charge's link list and the model links both name the receipt.
	listReq := httptest.NewRequest(http.MethodGet, "/v1/transactions/"+charge+"/receipts", nil)
	listResp := httptest.NewRecorder()
	world.plan.ServeHTTP(listResp, listReq)
	var links struct {
		Receipts []types.Receipt `json:"receipts"`
	}
	if err := json.Unmarshal(listResp.Body.Bytes(), &links); err != nil || len(links.Receipts) != 1 || links.Receipts[0].ID != attached.Receipt.ID {
		t.Fatalf("links = %+v, want the confirmed receipt", links)
	}
	modelReq := httptest.NewRequest(http.MethodGet, "/v1/financial-model", nil)
	modelResp := httptest.NewRecorder()
	world.plan.ServeHTTP(modelResp, modelReq)
	var modelBody struct {
		ReceiptLinks map[string][]string `json:"receiptLinks"`
	}
	if err := json.Unmarshal(modelResp.Body.Bytes(), &modelBody); err != nil {
		t.Fatal(err)
	}
	if len(modelBody.ReceiptLinks[charge]) != 1 || modelBody.ReceiptLinks[charge][0] != attached.Receipt.ID {
		t.Fatalf("model links = %+v, want the charge linked", modelBody.ReceiptLinks)
	}

	// The repeat bank feed (re-sync) adds nothing and keeps the link.
	before, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	ledgerApplyFeeds(t, world, len(world.pack.BankFeeds())-1, len(world.pack.BankFeeds()))
	after, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Transactions) != len(after.Transactions) {
		t.Fatalf("transactions = %d after re-sync, want %d", len(after.Transactions), len(before.Transactions))
	}
	stillReq := httptest.NewRequest(http.MethodGet, "/v1/transactions/"+charge+"/receipts", nil)
	stillResp := httptest.NewRecorder()
	world.plan.ServeHTTP(stillResp, stillReq)
	var still struct {
		Receipts []types.Receipt `json:"receipts"`
	}
	if err := json.Unmarshal(stillResp.Body.Bytes(), &still); err != nil || len(still.Receipts) != 1 || still.Receipts[0].Confirmed == nil {
		t.Fatalf("links after re-sync = %+v, want the confirmed receipt intact", still)
	}
}
