package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const receiptAPIPostingID = "01900000-0000-7000-8000-000000000087"

func receiptAPIStore(t *testing.T) store.Store {
	t.Helper()
	db := openAPIStore(t)
	if _, err := db.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	account := "checking"
	if _, err := db.CreatePosting(types.Posting{ID: receiptAPIPostingID, Name: "Expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "12.34"}, Inputs: map[string]types.AmountInputBinding{}}, TransactionTime: 1, PostedTime: 1, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return db
}

func receiptUpload(t *testing.T, h http.Handler, image []byte) *httptest.ResponseRecorder {
	t.Helper()
	return receiptMultipartRequest(t, h, "POST", "/v1/receipts", map[string]string{"postingId": receiptAPIPostingID}, image)
}

func receiptMultipartRequest(t *testing.T, h http.Handler, method, path string, fields map[string]string, image []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for name, value := range fields {
		if err := form.WriteField(name, value); err != nil {
			t.Fatal(err)
		}
	}
	part, err := form.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="image"; filename="receipt.png"`}, "Content-Type": {"image/png"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(image); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	rq := httptest.NewRequest(method, path, &body)
	rq.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	h.ServeHTTP(w, rq)
	return w
}

func receiptRequest(h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	var input io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		input = bytes.NewReader(data)
	}
	rq := httptest.NewRequest(method, path, input)
	if body != nil {
		rq.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, rq)
	return w
}

func decodeReceipt(t *testing.T, w *httptest.ResponseRecorder) types.Receipt {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("receipt response=%d %s", w.Code, w.Body.String())
	}
	var payload struct {
		Receipt types.Receipt `json:"receipt"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Receipt
}

type replacementReceiptExtractor struct{}

func (replacementReceiptExtractor) Extract(ctx context.Context, input receipts.ExtractionInput) (receipts.ExtractionResult, error) {
	if err := ctx.Err(); err != nil {
		return receipts.ExtractionResult{}, err
	}
	total := int64(1234)
	return receipts.ExtractionResult{Details: types.ReceiptDetails{Merchant: "Other source", Date: "2026-10-20", Currency: "USD", TotalCents: &total, Items: []types.ReceiptItem{}}}, nil
}

func TestReceiptHTTPContractSurvivesAdapterSwap(t *testing.T) {
	local, err := receiptmock.NewWithLatency(0)
	if err != nil {
		t.Fatal(err)
	}
	other, err := receipts.NewSource(types.ReceiptProvenance{Producer: "other", Version: "2"}, replacementReceiptExtractor{})
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string]*receipts.Source{"mock": local, "replacement": other} {
		t.Run(name, func(t *testing.T) {
			db := receiptAPIStore(t)
			h := New(db, Config{ReceiptSource: source})
			before, _ := db.LoadDocument()
			revision, _ := store.DocumentETag(before)
			upload := receiptUpload(t, h, receiptmock.SampleImage)
			r := decodeReceipt(t, upload)
			if upload.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("private metadata cached")
			}
			if r.Extraction != nil {
				t.Fatal("upload triggered extraction")
			}
			duplicate := decodeReceipt(t, receiptUpload(t, h, receiptmock.SampleImage))
			if duplicate.ID != r.ID {
				t.Fatal("duplicate upload not deduplicated")
			}
			image := receiptRequest(h, "GET", "/v1/receipts/"+r.ID+"/image?download=true", nil)
			if image.Code != 200 || image.Header().Get("Content-Type") != "image/png" || image.Header().Get("X-Content-Type-Options") != "nosniff" || image.Header().Get("Cache-Control") != "private, no-store" || image.Header().Get("Content-Disposition") == "" {
				t.Fatalf("image headers: %d %v", image.Code, image.Header())
			}
			if len(image.Body.Bytes()) == 0 {
				t.Fatal("empty image")
			}
			r = decodeReceipt(t, receiptRequest(h, "POST", "/v1/receipts/"+r.ID+"/extract", nil))
			if r.Extraction == nil || r.Status != "ready" {
				t.Fatalf("extraction=%+v", r)
			}
			details := r.Extraction.Details
			details.Merchant = "User correction"
			reviewBody := map[string]any{"revision": r.Revision, "details": details, "confirm": true}
			r = decodeReceipt(t, receiptRequest(h, "PATCH", "/v1/receipts/"+r.ID, reviewBody))
			if r.Confirmed == nil || r.Confirmed.Merchant != "User correction" {
				t.Fatal("review not persisted")
			}
			stale := receiptRequest(h, "PATCH", "/v1/receipts/"+r.ID, reviewBody)
			if stale.Code != 409 {
				t.Fatalf("stale=%d %s", stale.Code, stale.Body.String())
			}
			if got := receiptRequest(h, "GET", "/v1/postings/"+receiptAPIPostingID+"/receipts", nil); got.Code != 200 {
				t.Fatal(got.Body.String())
			}
			if got := receiptRequest(h, "DELETE", "/v1/receipts/"+r.ID, nil); got.Code != 200 {
				t.Fatal(got.Body.String())
			}
			if got := receiptRequest(h, "GET", "/v1/receipts/"+r.ID, nil); got.Code != 404 {
				t.Fatal("deleted receipt remains")
			}
			after, _ := db.LoadDocument()
			gotRevision, _ := store.DocumentETag(after)
			if gotRevision != revision {
				t.Fatal("receipt operation changed financial revision")
			}
		})
	}
}

func TestReceiptReadOnlyAndInputBoundaries(t *testing.T) {
	db := receiptAPIStore(t)
	h := New(db, Config{})
	r := decodeReceipt(t, receiptUpload(t, h, receiptmock.SampleImage))
	ro := New(db, Config{ReadOnly: true})
	for _, call := range []struct{ method, path string }{{"POST", "/v1/receipts"}, {"POST", "/v1/receipts/" + r.ID + "/extract"}, {"PATCH", "/v1/receipts/" + r.ID}, {"PUT", "/v1/receipts/" + r.ID + "/image"}, {"DELETE", "/v1/receipts/" + r.ID}} {
		w := receiptRequest(ro, call.method, call.path, nil)
		if w.Code != 403 {
			t.Fatalf("%s %s=%d", call.method, call.path, w.Code)
		}
	}
	if got := receiptRequest(ro, "GET", "/v1/receipts/"+r.ID+"/image", nil); got.Code != 200 {
		t.Fatal(got.Body.String())
	}
	if got := receiptUpload(t, h, []byte("not actually a PNG")); got.Code != 422 {
		t.Fatalf("spoofed=%d %s", got.Code, got.Body.String())
	}
	for _, length := range []int64{int64(receipts.MaxUploadBytes + 100000), -1} {
		rq := httptest.NewRequest("POST", "/v1/receipts", bytes.NewReader(bytes.Repeat([]byte("x"), receipts.MaxUploadBytes+100000)))
		rq.ContentLength = length
		rq.Header.Set("Content-Type", "multipart/form-data; boundary=test")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, rq)
		if w.Code != 413 {
			t.Fatalf("oversize %d=%d %s", length, w.Code, w.Body.String())
		}
	}
	blocked := httptest.NewRequest("POST", "/v1/receipts", bytes.NewReader(nil))
	blocked.Header.Set("Origin", "https://untrusted.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, blocked)
	if w.Code != 403 {
		t.Fatalf("origin=%d", w.Code)
	}
	if disabled := receiptRequest(h, "POST", "/v1/receipts/"+r.ID+"/extract", nil); disabled.Code != 503 {
		t.Fatalf("disabled=%d", disabled.Code)
	}
}

func TestReceiptAPIPlanIsolation(t *testing.T) {
	database, err := sqlite.SetupDatabase(t.TempDir() + "/shared.db")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	a, err := database.EnsurePrivatePlan("plans/a", "a", "issuer", "a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := database.EnsurePrivatePlan("plans/b", "b", "issuer", "b")
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []store.Store{a, b} {
		if _, err := db.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
			t.Fatal(err)
		}
		account := "checking"
		if _, err := db.CreatePosting(types.Posting{ID: receiptAPIPostingID, Name: "Expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "1"}, Inputs: map[string]types.AmountInputBinding{}}, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	r := decodeReceipt(t, receiptUpload(t, New(a, Config{}), receiptmock.SampleImage))
	h := New(b, Config{})
	for _, path := range []string{"/v1/receipts/" + r.ID, "/v1/receipts/" + r.ID + "/image"} {
		if w := receiptRequest(h, "GET", path, nil); w.Code != 404 {
			t.Fatalf("cross-plan=%d", w.Code)
		}
	}
	if w := receiptRequest(h, "DELETE", "/v1/receipts/"+r.ID, nil); w.Code != 404 {
		t.Fatalf("cross-plan delete=%d", w.Code)
	}
	if w := receiptRequest(h, "POST", "/v1/receipts/"+r.ID+"/extract", nil); w.Code != 404 {
		t.Fatalf("cross-plan extraction=%d", w.Code)
	}
	if w := receiptMultipartRequest(t, h, "PUT", "/v1/receipts/"+r.ID+"/image", map[string]string{"revision": "1"}, receiptmock.SampleImage); w.Code != 404 {
		t.Fatalf("cross-plan replacement=%d %s", w.Code, w.Body.String())
	}
}
