package receipts_test

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts/extractortest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type extractorFunc func(context.Context, receipts.ExtractionInput) (receipts.ExtractionResult, error)

func (f extractorFunc) Extract(ctx context.Context, input receipts.ExtractionInput) (receipts.ExtractionResult, error) {
	return f(ctx, input)
}

const postingID = "01900000-0000-7000-8000-000000000088"

func serviceFixture(t *testing.T, source *receipts.Source) (store.Store, *receipts.Service, types.Receipt) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "receipts.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	account := "checking"
	if _, err := db.CreatePosting(types.Posting{ID: postingID, Name: "Expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "12.34"}, Inputs: map[string]types.AmountInputBinding{}}, PostedTime: 1, TransactionTime: 1, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	svc := receipts.NewService(db, source, "plans/test")
	image, err := receipts.NormalizeImage(bytes.NewReader(receiptmock.SampleImage))
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := svc.Attach(context.Background(), postingID, "market.png", image)
	if err != nil {
		t.Fatal(err)
	}
	return db, svc, receipt
}

func TestExtractorContractAndSourceSwap(t *testing.T) {
	mock, err := receiptmock.NewExtractor()
	if err != nil {
		t.Fatal(err)
	}
	image, err := receipts.NormalizeImage(bytes.NewReader(receiptmock.SampleImage))
	if err != nil {
		t.Fatal(err)
	}
	input := receipts.ExtractionInput{Image: image, RequestID: "stable-request"}
	var calls atomic.Int32
	other := extractorFunc(func(ctx context.Context, input receipts.ExtractionInput) (receipts.ExtractionResult, error) {
		if err := ctx.Err(); err != nil {
			return receipts.ExtractionResult{}, err
		}
		calls.Add(1)
		total := int64(1234)
		return receipts.ExtractionResult{Details: types.ReceiptDetails{Merchant: "Replacement source", Currency: "USD", Date: "2026-10-20", TotalCents: &total, Items: []types.ReceiptItem{}}}, nil
	})
	t.Run("mock", func(t *testing.T) { extractortest.Run(t, mock, input) })
	t.Run("replacement", func(t *testing.T) { extractortest.Run(t, other, input) })
	first, _ := receiptmock.NewWithLatency(0)
	db, svc, r := serviceFixture(t, first)
	r, err = svc.Extract(context.Background(), r.ID)
	if err != nil || r.Extraction == nil || !r.Extraction.Provenance.Simulated {
		t.Fatalf("extraction = %+v, %v", r, err)
	}
	details := r.Extraction.Details
	details.Merchant = "Corrected merchant"
	r, err = svc.Review(r.ID, r.Revision, details, true)
	if err != nil {
		t.Fatal(err)
	}
	second, _ := receipts.NewSource(types.ReceiptProvenance{Producer: "replacement", Version: "1"}, other)
	svc = receipts.NewService(db, second, "plans/test")
	before := calls.Load()
	r, err = svc.Extract(context.Background(), r.ID)
	if err != nil || calls.Load() != before+1 {
		t.Fatalf("replacement source not called: %v", err)
	}
	if r.Confirmed.Merchant != "Corrected merchant" || r.Extraction.Details.Merchant != "Replacement source" || r.ConfirmedProvenance == nil || !r.ConfirmedProvenance.Simulated {
		t.Fatalf("lost corrections/provenance: %+v", r)
	}
	if r.Extraction.Provenance.Simulated {
		t.Fatal("real provenance inherited mock identity")
	}
	if _, err := svc.Extract(context.Background(), r.ID); err != nil || calls.Load() != before+1 {
		t.Fatal("same source result not reused")
	}
	third, _ := receipts.NewSource(types.ReceiptProvenance{Producer: "replacement", Version: "2"}, other)
	if _, err := receipts.NewService(db, third, "plans/test").Extract(context.Background(), r.ID); err != nil || calls.Load() != before+2 {
		t.Fatal("version change reused stale extraction")
	}
}

func TestExtractionFailureCasesKeepAttachment(t *testing.T) {
	cases := []struct {
		name   string
		result receipts.ExtractionResult
		err    error
		code   string
	}{
		{"timeout", receipts.ExtractionResult{}, context.DeadlineExceeded, "timeout"},
		{"canceled", receipts.ExtractionResult{}, context.Canceled, "canceled"},
		{"rate-limit", receipts.ExtractionResult{}, &receipts.Error{ReceiptProblem: types.ReceiptProblem{Code: "rate-limited", Message: "Try later.", Retryable: true, RetryAfterSeconds: 30}}, "rate-limited"},
		{"non-receipt", receipts.ExtractionResult{}, receipts.Failure("unrecognized-document", "No receipt details found.", false), "unrecognized-document"},
		{"unavailable", receipts.ExtractionResult{}, errors.New("secret upstream URL and private text"), "unavailable"},
		{"malformed", receipts.ExtractionResult{Details: types.ReceiptDetails{Currency: "EUR"}}, nil, "invalid-result"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source, _ := receipts.NewSource(types.ReceiptProvenance{Producer: "test", Version: "1"}, extractorFunc(func(context.Context, receipts.ExtractionInput) (receipts.ExtractionResult, error) {
				return tc.result, tc.err
			}))
			db, svc, r := serviceFixture(t, source)
			out, err := svc.Extract(context.Background(), r.ID)
			if err != nil || out.Status != "failed" || out.Problem == nil || out.Problem.Code != tc.code || strings.Contains(out.Problem.Message, "secret") {
				t.Fatalf("failure = %+v, %v", out, err)
			}
			if _, err := db.GetReceiptImage(context.Background(), r.ID); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestExtractionMergesConcurrentReviewAndBlocksDuplicates(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	source, _ := receipts.NewSource(types.ReceiptProvenance{Producer: "controlled", Version: "1"}, extractorFunc(func(ctx context.Context, input receipts.ExtractionInput) (receipts.ExtractionResult, error) {
		close(entered)
		select {
		case <-release:
			return receipts.ExtractionResult{Details: types.ReceiptDetails{Merchant: "Extracted"}}, nil
		case <-ctx.Done():
			return receipts.ExtractionResult{}, ctx.Err()
		}
	}))
	_, svc, r := serviceFixture(t, source)
	done := make(chan error, 1)
	go func() { _, err := svc.Extract(context.Background(), r.ID); done <- err }()
	<-entered
	if _, err := svc.Extract(context.Background(), r.ID); !errors.Is(err, store.ErrReceiptConflict) {
		t.Fatalf("duplicate extraction = %v", err)
	}
	r, err := svc.Get(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Review(r.ID, r.Revision, types.ReceiptDetails{Merchant: "My draft"}, false); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	r, err = svc.Get(r.ID)
	if err != nil || r.Draft.Merchant != "My draft" || r.Extraction.Details.Merchant != "Extracted" {
		t.Fatalf("concurrent review = %+v, %v", r, err)
	}
}

func TestManualModeStalenessAndDiagnostics(t *testing.T) {
	db, svc, r := serviceFixture(t, nil)
	if svc.Available() {
		t.Fatal("disabled source available")
	}
	if _, err := svc.Extract(context.Background(), r.ID); err == nil {
		t.Fatal("disabled source extracted")
	}
	if _, err := svc.Review(r.ID, r.Revision, types.ReceiptDetails{}, true); err == nil {
		t.Fatal("incomplete confirmation accepted")
	}
	total := int64(1000)
	r, err := svc.Review(r.ID, r.Revision, types.ReceiptDetails{Merchant: "Manual", Currency: "USD", Date: "2026-10-20", TotalCents: &total}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(svc.Diagnostics(r)) != 1 {
		t.Fatal("missing amount discrepancy")
	}
	if _, err := svc.Review(r.ID, r.Revision-1, *r.Confirmed, true); !errors.Is(err, store.ErrReceiptConflict) {
		t.Fatal(err)
	}
	doc, _ := db.LoadDocument()
	p := doc.Postings[0]
	p.Name = "Changed"
	if _, err := db.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	r, err = svc.Get(r.ID)
	if err != nil || !r.Stale {
		t.Fatal("missing stale evidence flag")
	}
}

func TestExtractionRecoveryReadsDoNotStartOrPersistAnAttempt(t *testing.T) {
	var calls atomic.Int32
	source, err := receipts.NewSource(types.ReceiptProvenance{Producer: "recovery", Version: "1"}, extractorFunc(func(ctx context.Context, input receipts.ExtractionInput) (receipts.ExtractionResult, error) {
		calls.Add(1)
		if input.ScopeID != "plans/test" || input.RequestID == "" {
			t.Error("missing scoped extraction identity")
		}
		return receipts.ExtractionResult{Details: types.ReceiptDetails{Merchant: "Recovered"}}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	db, svc, r := serviceFixture(t, source)
	r.Status, r.ExtractionStartedAt = "extracting", time.Now().UnixMilli()
	r, err = db.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	active, err := svc.Get(r.ID)
	if err != nil || active.Status != "extracting" {
		t.Fatalf("active view = %+v, %v", active, err)
	}
	r.ExtractionStartedAt = time.Now().Add(-2 * time.Minute).UnixMilli()
	r, err = db.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	interrupted, err := svc.Get(r.ID)
	if err != nil || interrupted.Status != "interrupted" || interrupted.Revision != r.Revision {
		t.Fatalf("interrupted view = %+v, %v", interrupted, err)
	}
	list, err := svc.List(r.PostingID)
	if err != nil || len(list) != 1 || list[0].Status != "interrupted" {
		t.Fatalf("list view = %+v, %v", list, err)
	}
	persisted, err := db.GetReceipt(r.ID)
	if err != nil || persisted.Status != "extracting" || persisted.Revision != r.Revision || calls.Load() != 0 {
		t.Fatalf("read changed state = %+v, %v", persisted, err)
	}
	recovered, err := svc.Extract(context.Background(), r.ID)
	if err != nil || recovered.Status != "ready" || calls.Load() != 1 {
		t.Fatalf("explicit recovery = %+v, %v", recovered, err)
	}
}

func TestReceiptDiagnosticsPreserveUnknownsAndReconcileAdjustments(t *testing.T) {
	_, svc, r := serviceFixture(t, nil)
	total, itemTotal, tax, tip, discount := int64(1234), int64(1000), int64(100), int64(200), int64(66)
	quantity := 1.5
	base := types.ReceiptDetails{Currency: "USD", TotalCents: &total, TaxCents: &tax, TipCents: &tip, DiscountCents: &discount, Items: []types.ReceiptItem{{Description: "Apples", Quantity: &quantity, TotalCents: &itemTotal}}}
	for _, tc := range []struct {
		name string
		edit func(*types.ReceiptDetails)
		want []string
	}{
		{"reconciled", func(*types.ReceiptDetails) {}, []string{}},
		{"unknown-currency-and-total", func(d *types.ReceiptDetails) { d.Currency, d.TotalCents = "", nil }, []string{"Receipt currency is unknown.", "Receipt total is unknown."}},
		{"missing-item-total", func(d *types.ReceiptDetails) { d.Items = []types.ReceiptItem{{Description: "Unknown item"}} }, []string{}},
		{"adjustment-mismatch", func(d *types.ReceiptDetails) { d.DiscountCents = nil }, []string{"Item totals, tax, tip, and discounts do not reconcile with the receipt total."}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			details := base
			tc.edit(&details)
			r.Draft = &details
			if got := svc.Diagnostics(r); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("diagnostics = %v, want %v", got, tc.want)
			}
		})
	}
	confidence := 0.4
	r.Draft = &base
	r.Extraction = &types.ReceiptExtraction{Confidence: &confidence}
	if got := svc.Diagnostics(r); len(got) != 1 || !strings.Contains(got[0], "low confidence") {
		t.Fatalf("confidence diagnostics = %v", got)
	}
}

func TestImageReplacementDiscardsAnEarlierExtractionCompletion(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	source, err := receipts.NewSource(types.ReceiptProvenance{Producer: "controlled", Version: "1"}, extractorFunc(func(context.Context, receipts.ExtractionInput) (receipts.ExtractionResult, error) {
		close(entered)
		<-release
		return receipts.ExtractionResult{Details: types.ReceiptDetails{Merchant: "Old image result"}}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	_, svc, r := serviceFixture(t, source)
	done := make(chan error, 1)
	go func() { _, err := svc.Extract(context.Background(), r.ID); done <- err }()
	<-entered
	r, err = svc.Get(r.ID)
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	updated, replaceErr := svc.ReplaceImage(context.Background(), r.ID, r.Revision, `folder/new.png`, types.ReceiptImage{Bytes: []byte("new pixels"), MediaType: "image/png"})
	close(release)
	if replaceErr != nil {
		t.Fatal(replaceErr)
	}
	if err := <-done; !errors.Is(err, store.ErrReceiptConflict) {
		t.Fatalf("old extraction completion = %v", err)
	}
	stored, err := svc.Get(r.ID)
	if err != nil || stored.Extraction != nil || stored.Status != "attached" || stored.Digest != updated.Digest || stored.Filename != "new.png" {
		t.Fatalf("replacement overwritten = %+v, %v", stored, err)
	}
}

func TestListLinksExposesReverseLookupWithoutSecondQuery(t *testing.T) {
	_, svc, r := serviceFixture(t, nil)
	links, err := svc.ListLinks()
	if err != nil {
		t.Fatal(err)
	}
	got, ok := links[postingID]
	if !ok || len(got) != 1 || got[0] != r.ID {
		t.Fatalf("links = %+v", links)
	}
	if _, err := svc.Review(r.ID, r.Revision, types.ReceiptDetails{Merchant: "Draft"}, false); err != nil {
		t.Fatal(err)
	}
	links, err = svc.ListLinks()
	if err != nil {
		t.Fatal(err)
	}
	if got := links[postingID]; len(got) != 1 || got[0] != r.ID {
		t.Fatalf("links after review = %+v", links)
	}
}
