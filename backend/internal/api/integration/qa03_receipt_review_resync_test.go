package integration

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"sort"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// QA-03 journey 1: receipt review against the real backend and store.
//
// Two receipt systems cross one bank re-sync here. Image receipts attach to a
// saved posting and are reviewed through the production receipts API; mail
// receipts arrive through the real Gmail scan/storage path. The extraction
// step in each path is a harness stand-in (the local image adapter, the
// Gmail fetch boundary), which the test names say outright. Everything else
// — transport, permissions, SQLite, the sync reconcile — is production code.

// qa03BankSync applies bank rows through the real reconcile path and returns
// the stored postings keyed by bank transaction ID.
func qa03BankSync(t *testing.T, scoped store.Store, transactions []simplefin.Transaction) {
	t.Helper()
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{
		ID: "bank", Currency: "USD", Balance: "1000", Transactions: transactions,
	}}}
	translation, err := simplefin.Translate(set, map[string]string{"bank": "checking"}, time.Now())
	if err != nil {
		t.Fatalf("map bank rows: %v", err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatalf("apply sync: %v", err)
	}
}

func qa03BankTxn(id, description, amount string, posted int64) simplefin.Transaction {
	return simplefin.Transaction{ID: id, Description: description, Amount: amount, Posted: posted}
}

// qa03BankFacts snapshots every stored posting as canonical JSON keyed by
// ID: the byte-level record a re-sync must leave untouched.
func qa03BankFacts(t *testing.T, scoped store.Store) map[string]string {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	facts := map[string]string{}
	for _, posting := range model.Postings {
		raw, err := json.Marshal(posting)
		if err != nil {
			t.Fatalf("marshal posting: %v", err)
		}
		facts[posting.ID] = string(raw)
	}
	return facts
}

func qa03PostingIDs(facts map[string]string) []string {
	ids := make([]string, 0, len(facts))
	for id := range facts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func qa03UploadToPosting(t *testing.T, handler http.Handler, postingID string, image []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	if err := form.WriteField("postingId", postingID); err != nil {
		t.Fatal(err)
	}
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="image"; filename="receipt.png"`},
		"Content-Type":        {"image/png"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(image); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/receipts", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

// An image receipt reviewed through the production API keeps its confirmed
// evidence and its posting link across a real bank re-sync, while
// untouched bank rows stay byte-identical and no duplicate rows appear.
// Extraction here runs on the harness image adapter, named as such.
func TestQA03ImageReceiptReviewSurvivesBankResyncWithHarnessExtraction(t *testing.T) {
	scoped := openAPIStore(t)
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	first := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC).Unix()
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-a", "GROCER 123", "-12.50", first),
		qa03BankTxn("bank-b", "FUEL STOP", "-30.00", first+60),
	})
	before := qa03BankFacts(t, scoped)
	if len(before) != 2 {
		t.Fatalf("seeded postings = %d, want 2", len(before))
	}
	targetID := qa03PostingIDs(before)[0]

	source, err := receiptmock.New()
	if err != nil {
		t.Fatal(err)
	}
	handler := New(scoped, Config{ReceiptSource: source})

	upload := qa03UploadToPosting(t, handler, targetID, receiptmock.SampleImage)
	receipt := decodeReceipt(t, upload)
	if receipt.Extraction != nil {
		t.Fatal("upload must not trigger extraction")
	}

	extracted := decodeReceipt(t, receiptRequest(handler, "POST", "/v1/receipts/"+receipt.ID+"/extract", nil))
	if extracted.Extraction == nil || extracted.Status != "ready" {
		t.Fatalf("extraction = %+v, want ready evidence from the harness adapter", extracted)
	}

	details := extracted.Extraction.Details
	details.Merchant = "Corrected corner store"
	confirmed := decodeReceipt(t, receiptRequest(handler, "PATCH", "/v1/receipts/"+receipt.ID, map[string]any{
		"revision": extracted.Revision, "details": details, "confirm": true,
	}))
	if confirmed.Confirmed == nil || confirmed.Confirmed.Merchant != "Corrected corner store" {
		t.Fatalf("confirmed = %+v, want the corrected merchant", confirmed)
	}

	// A second bank sync carrying the same rows plus one new row is the
	// real re-sync path: reconcile must not duplicate or rewrite.
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-a", "GROCER 123", "-12.50", first),
		qa03BankTxn("bank-b", "FUEL STOP", "-30.00", first+60),
		qa03BankTxn("bank-c", "BOOKSHOP", "-9.99", first+120),
	})
	after := qa03BankFacts(t, scoped)
	if len(after) != 3 {
		t.Fatalf("postings after re-sync = %d, want 3", len(after))
	}
	for id, fact := range before {
		if after[id] != fact {
			t.Fatalf("bank posting %s changed across re-sync:\nbefore %s\nafter  %s", id, fact, after[id])
		}
	}

	listed := receiptRequest(handler, "GET", "/v1/postings/"+targetID+"/receipts", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("receipt list = %d %s", listed.Code, listed.Body.String())
	}
	var links struct {
		Receipts []types.Receipt `json:"receipts"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &links); err != nil {
		t.Fatal(err)
	}
	if len(links.Receipts) != 1 || links.Receipts[0].ID != receipt.ID {
		t.Fatalf("links = %+v, want the single reviewed receipt", links.Receipts)
	}
	if links.Receipts[0].Confirmed == nil || links.Receipts[0].Confirmed.Merchant != "Corrected corner store" {
		t.Fatalf("link = %+v, want confirmed evidence intact", links.Receipts[0])
	}
	got := decodeReceipt(t, receiptRequest(handler, "GET", "/v1/receipts/"+receipt.ID, nil))
	if got.Extraction == nil || got.Extraction.Details.Merchant == "Corrected corner store" {
		t.Fatalf("receipt = %+v, want original extraction preserved beside the correction", got)
	}
}

// A mail receipt scanned through the real Gmail scan/storage path keeps its
// confirmed correction and original extraction across a bank re-sync, and
// repeat scans dedupe instead of duplicating. The Gmail fetch boundary is a
// fake fetcher (real Google OAuth is out of scope); the scan, triage,
// storage, review, and sync paths are production code.
func TestQA03MailReceiptReviewSurvivesBankResyncWithFakeGmailFetch(t *testing.T) {
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
	scoped := openAPIStore(t)
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	handler := New(scoped, Config{GmailService: service, GmailFrontendBaseURL: "https://app.example"})
	connectGmailForScan(t, handler)

	code, summary := scanGmail(t, handler)
	if code != http.StatusOK {
		t.Fatalf("scan = %d", code)
	}
	if summary.Receipts != 1 || summary.Triaged != 2 {
		t.Fatalf("summary = %+v, want 1 receipt of 2 triaged", summary)
	}

	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/receipts?verdict=receipt,refund", nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list = %d %s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Receipts []store.EmailReceipt `json:"receipts"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Receipts) != 1 || listed.Receipts[0].Reference != "AB-12345" {
		t.Fatalf("receipts = %+v, want the extracted reference", listed.Receipts)
	}
	if listed.Receipts[0].Provenance.Producer == "" {
		t.Fatalf("receipt = %+v, want source provenance", listed.Receipts[0])
	}

	reviewRequest := httptest.NewRequest(http.MethodPatch, "/v1/integrations/gmail/receipts/"+listed.Receipts[0].ID, bytes.NewReader([]byte(`{"correction":{"reference":"AB-12345-CORRECTED"}}`)))
	reviewRequest.Header.Set("Content-Type", "application/json")
	reviewResponse := httptest.NewRecorder()
	handler.ServeHTTP(reviewResponse, reviewRequest)
	if reviewResponse.Code != http.StatusOK {
		t.Fatalf("review = %d %s", reviewResponse.Code, reviewResponse.Body.String())
	}
	var reviewed struct {
		Receipt store.EmailReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(reviewResponse.Body.Bytes(), &reviewed); err != nil {
		t.Fatal(err)
	}
	if reviewed.Receipt.Status != store.EmailReceiptStatusConfirmed || reviewed.Receipt.Correction == nil {
		t.Fatalf("receipt = %+v, want confirmed with correction", reviewed.Receipt)
	}

	stamp := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC).Unix()
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-grocer", "GROCER 123", "-42.50", stamp),
	})
	bankBefore := qa03BankFacts(t, scoped)
	qa03BankSync(t, scoped, []simplefin.Transaction{
		qa03BankTxn("bank-grocer", "GROCER 123", "-42.50", stamp),
		qa03BankTxn("bank-fuel", "FUEL STOP", "-30.00", stamp+60),
	})
	bankAfter := qa03BankFacts(t, scoped)
	if len(bankAfter) != len(bankBefore)+1 {
		t.Fatalf("postings = %d, want one new row", len(bankAfter))
	}
	for id, fact := range bankBefore {
		if bankAfter[id] != fact {
			t.Fatalf("bank posting %s changed across re-sync", id)
		}
	}

	// The re-sync must not disturb the mail review, and a repeat scan must
	// dedupe instead of duplicating either receipts or postings.
	reread := httptest.NewRecorder()
	handler.ServeHTTP(reread, httptest.NewRequest(http.MethodGet, "/v1/integrations/gmail/receipts?verdict=receipt,refund", nil))
	var relisted struct {
		Receipts []store.EmailReceipt `json:"receipts"`
	}
	if err := json.Unmarshal(reread.Body.Bytes(), &relisted); err != nil {
		t.Fatal(err)
	}
	if len(relisted.Receipts) != 1 || relisted.Receipts[0].Status != store.EmailReceiptStatusConfirmed ||
		relisted.Receipts[0].Correction == nil || relisted.Receipts[0].Correction.Reference != "AB-12345-CORRECTED" ||
		relisted.Receipts[0].Reference != "AB-12345" {
		t.Fatalf("receipts = %+v, want the confirmed correction over the original extraction", relisted.Receipts)
	}
	if code, summary := scanGmail(t, handler); code != http.StatusOK || summary.Skipped != 2 || summary.Triaged != 0 {
		t.Fatalf("rescan = %d %+v, want 2 skipped", code, summary)
	}
	final := qa03BankFacts(t, scoped)
	if len(final) != len(bankAfter) {
		t.Fatalf("postings = %d, want no duplicates from the rescan", len(final))
	}
}
