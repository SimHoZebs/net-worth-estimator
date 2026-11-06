package gmail

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type fakeFetcher struct {
	ids       []string
	messages  map[string]Message
	failures  map[string]error
	listErr   error
	historyID string
	listCalls int
}

func (f *fakeFetcher) ListRecent(_ context.Context, _ string, _ time.Time, _ string) (MessagePage, error) {
	f.listCalls++
	if f.listErr != nil {
		return MessagePage{}, f.listErr
	}
	return MessagePage{IDs: f.ids, LatestHistoryID: f.historyID}, nil
}

func (f *fakeFetcher) ListSince(_ context.Context, _ string, _ string, _ string) (MessagePage, error) {
	f.listCalls++
	if f.listErr != nil {
		return MessagePage{}, f.listErr
	}
	return MessagePage{IDs: f.ids, LatestHistoryID: f.historyID}, nil
}

func (f *fakeFetcher) GetMessage(_ context.Context, _ string, id string) (Message, error) {
	if err, ok := f.failures[id]; ok {
		return Message{}, err
	}
	message, ok := f.messages[id]
	if !ok {
		return Message{}, errors.New("unknown message")
	}
	return message, nil
}

func connectTestStore(t *testing.T) store.Store {
	t.Helper()
	st, _ := openTestStore(t, "scanner")
	if _, err := st.ConnectGmail(store.GmailCredential{
		RefreshToken: "refresh-test", AccessToken: "access-test",
		AccessExpiryUnix: time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).Unix(),
		EmailAddress:     "reader@example.com", Scopes: ScopeReadonly,
	}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	return st
}

func receiptMessage(id string) Message {
	return Message{
		ID:      id,
		From:    "Example Store <receipts@example.com>",
		Subject: "Your order confirmation",
		Date:    time.Date(2026, 10, 20, 15, 4, 5, 0, time.UTC),
		Body:    "Thanks for your purchase!\nOrder number: AB-12345\nOrder total: $42.50\n",
	}
}

func TestDetectVerdict(t *testing.T) {
	cases := []struct {
		name    string
		from    string
		subject string
		body    string
		want    string
	}{
		{
			name:    "purchase receipt",
			from:    "Example Store <receipts@example.com>",
			subject: "Your order confirmation",
			body:    "Order total: $42.50",
			want:    store.EmailReceiptVerdictReceipt,
		},
		{
			name:    "refund receipt",
			from:    "Example Store <support@example.com>",
			subject: "Your refund confirmation",
			body:    "We've refunded $12.00 to your card.",
			want:    store.EmailReceiptVerdictRefund,
		},
		{
			name:    "shipping-only update excluded",
			from:    "Example Store <shipping@example.com>",
			subject: "Your package has shipped",
			body:    "Tracking number 1Z999. Your order is on its way.",
			want:    store.EmailReceiptVerdictShipping,
		},
		{
			name:    "shipping with amount stays a receipt",
			from:    "Example Store <receipts@example.com>",
			subject: "Order receipt",
			body:    "Shipped today. Order total: $42.50",
			want:    store.EmailReceiptVerdictReceipt,
		},
		{
			name:    "ordinary mail excluded",
			from:    "Friend <friend@example.com>",
			subject: "Weekend plans",
			body:    "Want to grab lunch on Saturday?",
			want:    store.EmailReceiptVerdictOrdinary,
		},
		{
			name:    "newsletter with price but no receipt signal stays ordinary",
			from:    "Deals <deals@example.com>",
			subject: "This week's deals",
			body:    "Headphones now $59.99, this week only.",
			want:    store.EmailReceiptVerdictOrdinary,
		},
	}
	for _, tc := range cases {
		if got := DetectVerdict(tc.from, tc.subject, tc.body); got != tc.want {
			t.Errorf("%s verdict = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestExtractReceipt(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	extraction := ExtractReceipt(receiptMessage("msg-1"), now)
	if extraction.Merchant != "Example Store" {
		t.Errorf("merchant = %q, want Example Store", extraction.Merchant)
	}
	if extraction.ReceiptDate != "2026-10-20" {
		t.Errorf("date = %q, want 2026-10-20", extraction.ReceiptDate)
	}
	if !extraction.HasAmount || extraction.AmountCents != 4250 {
		t.Errorf("amount = %v/%d, want 4250 cents", extraction.HasAmount, extraction.AmountCents)
	}
	if extraction.Currency != "USD" {
		t.Errorf("currency = %q, want USD", extraction.Currency)
	}
	if extraction.Reference != "AB-12345" {
		t.Errorf("reference = %q, want AB-12345", extraction.Reference)
	}
	if extraction.Confidence < ReadyConfidenceThreshold {
		t.Errorf("confidence = %v, want at least %v", extraction.Confidence, ReadyConfidenceThreshold)
	}
}

func TestExtractReceiptWithoutAmountNeedsReview(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	message := Message{
		ID:      "msg-2",
		From:    "Example Store <receipts@example.com>",
		Subject: "Payment receipt",
		Date:    now,
		Body:    "Your invoice INV-7788 is attached. Amount: $19.99",
	}
	extraction := ExtractReceipt(message, now)
	if !extraction.HasAmount {
		t.Fatal("expected an amount from the invoice body")
	}
	if extraction.Reference != "INV-7788" {
		t.Errorf("reference = %q, want INV-7788", extraction.Reference)
	}
	partial := Message{ID: "msg-3", From: "", Subject: "Receipt", Date: time.Time{}, Body: "Total: $5.00"}
	weak := ExtractReceipt(partial, now)
	if weak.HasAmount && weak.Merchant == "" && len(weak.Diagnostics) == 0 {
		t.Fatal("partial extraction reports no diagnostics")
	}
	if weak.Confidence >= ReadyConfidenceThreshold {
		t.Errorf("partial confidence = %v, want below review threshold", weak.Confidence)
	}
}

func connectAndScan(t *testing.T, fetcher *fakeFetcher) (store.Store, *Service, ScanSummary) {
	t.Helper()
	st := connectTestStore(t)
	service := testService(&fakeExchange{}, &fakeRoundTripper{profileCode: 200})
	summary, err := service.ScanWith(context.Background(), st, fetcher)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	return st, service, summary
}

func TestScanExtractsAndAdvancesCursor(t *testing.T) {
	fetcher := &fakeFetcher{
		ids: []string{"receipt-1", "ship-1", "plain-1"},
		messages: map[string]Message{
			"receipt-1": receiptMessage("receipt-1"),
			"ship-1": {
				ID: "ship-1", From: "Example Store <shipping@example.com>",
				Subject: "Your package has shipped",
				Date:    time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC),
				Body:    "Tracking number 1Z999. On its way!",
			},
			"plain-1": {
				ID: "plain-1", From: "Friend <friend@example.com>",
				Subject: "Weekend plans", Date: time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC),
				Body: "Lunch Saturday?",
			},
		},
		historyID: "history-10",
	}
	st, _, summary := connectAndScan(t, fetcher)
	if summary.Listed != 3 || summary.Triaged != 3 {
		t.Fatalf("summary = %+v, want 3 listed and triaged", summary)
	}
	if summary.Receipts != 1 {
		t.Fatalf("summary = %+v, want 1 receipt", summary)
	}
	receipts, err := st.ListEmailReceipts(store.EmailReceiptFilter{})
	if err != nil || len(receipts) != 3 {
		t.Fatalf("stored = %d, err %v, want 3 triage rows", len(receipts), err)
	}
	byID := map[string]store.EmailReceipt{}
	for _, item := range receipts {
		byID[item.GmailMessageID] = item
	}
	receipt := byID["receipt-1"]
	if receipt.Verdict != store.EmailReceiptVerdictReceipt || receipt.Merchant != "Example Store" {
		t.Fatalf("receipt = %+v, want extracted merchant", receipt)
	}
	if receipt.AmountCents == nil || *receipt.AmountCents != 4250 || receipt.Currency != "USD" || receipt.Reference != "AB-12345" {
		t.Fatalf("receipt = %+v, want amount/currency/reference", receipt)
	}
	if receipt.Provenance.Producer != ReceiptProducer || receipt.Provenance.Version != ReceiptProducerVersion {
		t.Fatalf("provenance = %+v, want gmail receipt producer identity", receipt.Provenance)
	}
	shipping := byID["ship-1"]
	if shipping.Verdict != store.EmailReceiptVerdictShipping {
		t.Fatalf("shipping verdict = %q", shipping.Verdict)
	}
	if shipping.Merchant != "" || shipping.AmountCents != nil || shipping.Subject != "" {
		t.Fatalf("shipping = %+v, want identity and verdict only", shipping)
	}
	credential, err := st.GetGmailCredential()
	if err != nil || credential.LastHistoryID != "history-10" || credential.LastScanAt == "" {
		t.Fatalf("cursor = %+v, err %v, want advanced history cursor", credential, err)
	}
}

func TestScanDedupesRepeatScans(t *testing.T) {
	fetcher := &fakeFetcher{
		ids:       []string{"receipt-1"},
		messages:  map[string]Message{"receipt-1": receiptMessage("receipt-1")},
		historyID: "history-11",
	}
	st, service, _ := connectAndScan(t, fetcher)
	summary, err := service.ScanWith(context.Background(), st, fetcher)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if summary.Skipped != 1 || summary.Triaged != 0 {
		t.Fatalf("rescan summary = %+v, want 1 skipped and none triaged", summary)
	}
	receipts, err := st.ListEmailReceipts(store.EmailReceiptFilter{})
	if err != nil || len(receipts) != 1 {
		t.Fatalf("stored = %d, err %v, want 1 row after repeat scan", len(receipts), err)
	}
	if fetcher.listCalls != 2 {
		t.Fatalf("list calls = %d, want incremental rescan to relist", fetcher.listCalls)
	}
}

func TestScanIsolatesMessageFailures(t *testing.T) {
	fetcher := &fakeFetcher{
		ids:       []string{"receipt-1", "broken-1"},
		messages:  map[string]Message{"receipt-1": receiptMessage("receipt-1")},
		failures:  map[string]error{"broken-1": errors.New("fetch boom")},
		historyID: "history-12",
	}
	st, _, summary := connectAndScan(t, fetcher)
	if summary.Failed != 1 || summary.Receipts != 1 {
		t.Fatalf("summary = %+v, want 1 failed plus 1 receipt", summary)
	}
	failed, err := st.ListEmailReceipts(store.EmailReceiptFilter{Verdict: []string{store.EmailReceiptVerdictFailed}})
	if err != nil || len(failed) != 1 || len(failed[0].Diagnostics) == 0 {
		t.Fatalf("failed rows = %+v, err %v, want 1 with diagnostics", failed, err)
	}
	model, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	if model != nil && (len(model.Transactions) != 0 || len(model.Accounts) != 0) {
		t.Fatalf("scan touched financial state: %+v", model)
	}
}

func TestScanRequiresConnection(t *testing.T) {
	st, _ := openTestStore(t, "disconnected")
	service := testService(&fakeExchange{}, &fakeRoundTripper{profileCode: 200})
	if _, err := service.ScanWith(context.Background(), st, &fakeFetcher{}); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v, want not connected", err)
	}
	if _, err := New(Config{}).Scan(context.Background(), st); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want not configured", err)
	}
}

func TestScanListFailureStoresNothing(t *testing.T) {
	st := connectTestStore(t)
	service := testService(&fakeExchange{}, &fakeRoundTripper{profileCode: 200})
	if _, err := service.ScanWith(context.Background(), st, &fakeFetcher{listErr: errors.New("list boom")}); err == nil {
		t.Fatal("expected list failure")
	}
	receipts, err := st.ListEmailReceipts(store.EmailReceiptFilter{})
	if err != nil || len(receipts) != 0 {
		t.Fatalf("stored = %d, err %v, want nothing after list failure", len(receipts), err)
	}
}

func TestScanEstablishesCursorFromMessages(t *testing.T) {
	// The production initial listing carries no history ID: fetched
	// messages must still establish the cursor for incremental follow-ups.
	message := receiptMessage("receipt-1")
	message.HistoryID = "987"
	fetcher := &fakeFetcher{
		ids:      []string{"receipt-1"},
		messages: map[string]Message{"receipt-1": message},
	}
	st := connectTestStore(t)
	service := testService(&fakeExchange{}, &fakeRoundTripper{profileCode: 200})
	if _, err := service.ScanWith(context.Background(), st, fetcher); err != nil {
		t.Fatalf("scan: %v", err)
	}
	credential, err := st.GetGmailCredential()
	if err != nil || credential.LastHistoryID != "987" {
		t.Fatalf("cursor = %+v, err %v, want message history cursor", credential, err)
	}
}

func TestTruncatedScanKeepsCursor(t *testing.T) {
	ids := make([]string, 0, MaxMessagesPerScan+5)
	messages := map[string]Message{}
	for i := 0; i < MaxMessagesPerScan+5; i++ {
		id := "bulk-" + strconv.Itoa(i)
		ids = append(ids, id)
		message := receiptMessage(id)
		message.HistoryID = "500"
		messages[id] = message
	}
	fetcher := &fakeFetcher{ids: ids, messages: messages, historyID: "999"}
	st := connectTestStore(t)
	service := testService(&fakeExchange{}, &fakeRoundTripper{profileCode: 200})
	summary, err := service.ScanWith(context.Background(), st, fetcher)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if !summary.Truncated || summary.Triaged != MaxMessagesPerScan {
		t.Fatalf("summary = %+v, want truncation at %d triaged", summary, MaxMessagesPerScan)
	}
	credential, err := st.GetGmailCredential()
	if err != nil || credential.LastHistoryID != "" {
		t.Fatalf("cursor = %+v, err %v, want stored cursor kept past untriaged work", credential, err)
	}
	// The next scan resumes the same listing and dedupes triaged rows.
	second, err := service.ScanWith(context.Background(), st, fetcher)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	if second.Triaged != 5 || second.Truncated {
		t.Fatalf("rescan = %+v, want the 5 remaining rows triaged without truncation", second)
	}
	credential, err = st.GetGmailCredential()
	if err != nil || credential.LastHistoryID != "999" {
		t.Fatalf("cursor = %+v, err %v, want cursor advanced after completion", credential, err)
	}
}
