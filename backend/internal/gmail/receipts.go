// Receipt discovery over Gmail (INT-03). Detection and extraction are
// deterministic local heuristics over message headers and plain-text
// content, in the same spirit as the Analysis catalog rules: they
// recognize evidence shapes, never identities, and their confidence is
// qualitative, not a calibrated probability. No accuracy guarantee exists.
//
// The scanner consumes the INT-02 connection pieces: ValidToken supplies
// the short-lived access token, Window/SWindowFor supply the initial or
// incremental scan range, and SetGmailScanCursor advances the history
// cursor after a completed scan. Scanning writes only email-receipt
// triage rows and the scan cursor: it holds no reference to postings,
// checkpoints, or balances, so a parser error can never mutate financial
// state. Message bodies and snippets are never persisted; only the
// message identity, display headers for receipt-like mail, extracted
// evidence, provenance, and review state are stored.
package gmail

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// ReceiptProducer and ReceiptProducerVersion identify extracted email
// receipt provenance. They version the complete detector/extractor
// composition so a future change invalidates cached review standing the
// same way receipt Source identity versions extraction reuse.
const (
	ReceiptProducer        = "gmail-receipt-email"
	ReceiptProducerVersion = "v1"
)

// ReadyConfidenceThreshold is the minimum extraction confidence that
// needs no user review. Anything below it is stored as needs-review.
const ReadyConfidenceThreshold = 0.75

// MaxMessagesPerScan bounds one scan so a large mailbox cannot hold the
// request open. The scan reports truncation and the cursor still
// advances past triaged messages, so the next scan resumes after them.
const MaxMessagesPerScan = 100

// MaxListPages bounds message-list pagination per scan.
const MaxListPages = 10

// Message is one Gmail message fetched for receipt discovery: headers
// plus plain-text content. It never reaches storage.
type Message struct {
	ID        string
	ThreadID  string
	HistoryID string
	From      string
	Subject   string
	Date      time.Time
	Body      string
}

// MessagePage is one listing response: candidate message IDs plus the
// newest history ID observed for cursor advance.
type MessagePage struct {
	IDs             []string
	NextPageToken   string
	LatestHistoryID string
}

// MessageFetcher lists and fetches Gmail messages with a short-lived
// access token. The production implementation calls the Gmail REST API;
// tests substitute a fake. Secrets never enter listings or messages.
type MessageFetcher interface {
	// ListRecent lists recent message IDs after the given time for the
	// initial scan. Query bounds the window; pageToken pages within it.
	ListRecent(ctx context.Context, token string, after time.Time, pageToken string) (MessagePage, error)
	// ListSince lists message IDs changed since the history cursor for
	// incremental scans.
	ListSince(ctx context.Context, token string, historyID string, pageToken string) (MessagePage, error)
	// GetMessage fetches one message with headers and plain-text content.
	GetMessage(ctx context.Context, token string, id string) (Message, error)
}

// ScanStore is the narrow persistence the scanner needs. store.Store
// satisfies it; tests substitute a fake.
type ScanStore interface {
	GetGmailCredential() (store.GmailCredential, error)
	UpdateGmailToken(accessToken string, accessExpiryUnix int64, refreshToken string) (store.GmailCredential, error)
	SetGmailScanCursor(historyID, scannedAt string) (store.GmailCredential, error)
	SaveEmailReceipt(receipt store.EmailReceipt) (store.EmailReceipt, error)
	IsGmailMessageScanned(messageID string) (bool, error)
}

// ScanSummary counts one completed scan for the user.
type ScanSummary struct {
	// Incremental reports whether the scan resumed from a cursor.
	Incremental bool `json:"incremental"`
	// Listed counts listed candidate message IDs.
	Listed int `json:"listed"`
	// Triaged counts newly triaged messages.
	Triaged int `json:"triaged"`
	// Receipts counts likely purchase receipts extracted.
	Receipts int `json:"receipts"`
	// Refunds counts likely refund receipts extracted.
	Refunds int `json:"refunds"`
	// NeedsReview counts extracted receipts below the review threshold.
	NeedsReview int `json:"needsReview"`
	// Skipped counts already-triaged messages deduped without refetching.
	Skipped int `json:"skipped"`
	// Failed counts per-message fetch/parse failures isolated with
	// diagnostics. They never fail the scan or touch balances.
	Failed int `json:"failed"`
	// Truncated reports whether listing or fetching hit the per-scan
	// bound; the next scan resumes after the triaged messages.
	Truncated bool `json:"truncated"`
}

var receiptSignals = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(?:receipt|order confirmation|order confirmed|invoice|payment receipt|payment confirmation|purchase confirmation|e-receipt|your order|order receipt|billing receipt|sales receipt)\b`),
	regexp.MustCompile(`(?i)\b(?:charged|payment of|amount paid|total charged|order total|grand total|amount due|balance due|paid in full)\b`),
}

var refundSignals = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(?:refund issued|refund confirmation|refund receipt|we've refunded|you've been refunded|return processed|return accepted|credit issued|reversal completed)\b`),
}

var shippingSignals = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(?:has shipped|your package|tracking number|out for delivery|arriving|delivered|in transit|shipment|dispatch(?:ed)?|on its way|estimated delivery)\b`),
}

var amountSignals = []*regexp.Regexp{
	regexp.MustCompile(`\$[\d,]+\.\d{2}`),
	regexp.MustCompile(`(?i)\bUSD\s*[\d,]+\.\d{2}\b`),
	regexp.MustCompile(`(?i)\b[\d,]+\.\d{2}\s*USD\b`),
	regexp.MustCompile(`(?i)\b[A-Z]{3}\s*[\d,]+\.\d{2}\b`),
	regexp.MustCompile(`(?i)\b[\d,]+\.\d{2}\s*[A-Z]{3}\b`),
}

var totalContext = regexp.MustCompile(`(?i)\b(?:total|amount|charged?|paid|refund(?:ed|s)?|credit|due|balance)\b`)

var referencePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\border\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,40})`),
	regexp.MustCompile(`(?i)\binvoice\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,40})`),
	regexp.MustCompile(`(?i)\bconfirmation\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,40})`),
	regexp.MustCompile(`(?i)\breceipt\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,40})`),
}

var currencyCode = regexp.MustCompile(`\b([A-Z]{3})\b`)

func matchAny(patterns []*regexp.Regexp, text string) bool {
	for _, pattern := range patterns {
		if pattern.MatchString(text) {
			return true
		}
	}
	return false
}

// DetectVerdict triages one message. Receipt and refund verdicts carry
// extraction evidence; shipping-only updates and ordinary mail are
// excluded from extraction and keep identity plus verdict only.
func DetectVerdict(from, subject, body string) string {
	text := strings.Join([]string{from, subject, body}, "\n")
	if matchAny(refundSignals, text) && matchAny(amountSignals, text) {
		return store.EmailReceiptVerdictRefund
	}
	if matchAny(receiptSignals, text) && matchAny(amountSignals, text) {
		return store.EmailReceiptVerdictReceipt
	}
	if matchAny(shippingSignals, text) {
		return store.EmailReceiptVerdictShipping
	}
	return store.EmailReceiptVerdictOrdinary
}

// Extraction is the structured parse of one receipt-like message.
type Extraction struct {
	Merchant    string
	ReceiptDate string
	AmountText  string
	AmountCents int64
	HasAmount   bool
	Currency    string
	Reference   string
	Confidence  float64
	Diagnostics []string
}

// merchantFromAddress derives the merchant from the sender display name:
// "Example Store <receipts@example.com>" yields "Example Store". A bare
// address yields its domain.
func merchantFromAddress(from string) string {
	trimmed := strings.TrimSpace(from)
	if trimmed == "" {
		return ""
	}
	if start := strings.Index(trimmed, "<"); start >= 0 {
		display := strings.TrimSpace(strings.Trim(trimmed[:start], `"' `))
		if display != "" {
			return display
		}
		trimmed = strings.TrimSpace(trimmed[start:])
		trimmed = strings.Trim(trimmed, "<>")
	}
	if at := strings.Index(trimmed, "@"); at >= 0 {
		host := trimmed[at+1:]
		if end := strings.IndexAny(host, " >"); end >= 0 {
			host = host[:end]
		}
		if dot := strings.Index(host, "."); dot > 0 {
			return host[:dot]
		}
		return host
	}
	return trimmed
}

type moneyMatch struct {
	text     string
	cents    int64
	currency string
	context  bool
}

func parseMoney(text string) (int64, string, bool) {
	trimmed := strings.TrimSpace(text)
	currency := "USD"
	if code := currencyCode.FindString(trimmed); code != "" {
		currency = code
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' || r == '.' {
			return r
		}
		return -1
	}, trimmed)
	if digits == "" {
		return 0, "", false
	}
	amount, err := strconv.ParseFloat(digits, 64)
	if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > 1e10 {
		return 0, "", false
	}
	return int64(math.Round(amount * 100)), currency, true
}

// extractAmounts finds candidate money values, preferring amounts near
// total/charge/paid/refund context over incidental figures.
func extractAmounts(text string) []moneyMatch {
	matches := []moneyMatch{}
	seen := map[string]bool{}
	lines := strings.Split(text, "\n")
	for _, line := range lines {
		for _, pattern := range amountSignals {
			for _, hit := range pattern.FindAllString(line, -1) {
				if seen[hit] {
					continue
				}
				seen[hit] = true
				cents, currency, ok := parseMoney(hit)
				if !ok {
					continue
				}
				matches = append(matches, moneyMatch{
					text:     hit,
					cents:    cents,
					currency: currency,
					context:  totalContext.MatchString(line),
				})
			}
		}
	}
	return matches
}

// ExtractReceipt parses merchant, date, amount, currency, and reference
// from one receipt-like message. The message date supplies the receipt
// date; a missing or unusable field lowers confidence instead of failing,
// so partial evidence still reaches review.
func ExtractReceipt(message Message, now time.Time) Extraction {
	result := Extraction{Diagnostics: []string{}}
	if merchant := merchantFromAddress(message.From); merchant != "" {
		result.Merchant = merchant
	} else {
		result.Diagnostics = append(result.Diagnostics, "sender has no usable merchant name")
	}
	if !message.Date.IsZero() {
		result.ReceiptDate = message.Date.UTC().Format("2006-01-02")
	} else {
		result.ReceiptDate = now.UTC().Format("2006-01-02")
		result.Diagnostics = append(result.Diagnostics, "message date is missing; scan date used instead")
	}
	text := strings.Join([]string{message.Subject, message.Body}, "\n")
	amounts := extractAmounts(text)
	best := -1
	for i, candidate := range amounts {
		if candidate.context {
			best = i
			break
		}
	}
	if best < 0 && len(amounts) > 0 {
		best = 0
	}
	if best >= 0 {
		result.AmountText = amounts[best].text
		result.AmountCents = amounts[best].cents
		result.HasAmount = true
		result.Currency = amounts[best].currency
	} else {
		result.Diagnostics = append(result.Diagnostics, "no usable amount found")
	}
	for _, pattern := range referencePatterns {
		if found := pattern.FindStringSubmatch(text); len(found) == 2 {
			candidate := strings.Trim(found[1], "-#:. ")
			// References carry digits; without one the match is an
			// ordinary word after a receipt keyword (e.g. "Total").
			if strings.ContainsAny(candidate, "0123456789") {
				result.Reference = candidate
				break
			}
		}
	}
	confidence := 0.5
	if result.Merchant != "" {
		confidence += 0.15
	}
	if !message.Date.IsZero() {
		confidence += 0.1
	}
	if result.HasAmount {
		confidence += 0.15
	}
	if result.Reference != "" {
		confidence += 0.05
	}
	if best >= 0 && amounts[best].context {
		confidence += 0.05
	}
	if confidence > 1 {
		confidence = 1
	}
	result.Confidence = math.Round(confidence*100) / 100
	return result
}

// extractionStatus maps extraction confidence to review standing: full
// evidence without warnings is ready; anything weaker needs review.
func extractionStatus(verdict string, extraction Extraction) string {
	if verdict != store.EmailReceiptVerdictReceipt && verdict != store.EmailReceiptVerdictRefund {
		return store.EmailReceiptStatusReady
	}
	if !extraction.HasAmount || extraction.Confidence < ReadyConfidenceThreshold {
		return store.EmailReceiptStatusNeedsReview
	}
	return store.EmailReceiptStatusReady
}

// newerHistoryID reports the newer of two Gmail history IDs. History
// IDs are numeric strings; unparseable values keep the first one.
func newerHistoryID(first, second string) string {
	if first == "" {
		return second
	}
	if second == "" {
		return first
	}
	older, err := strconv.ParseUint(first, 10, 64)
	if err != nil {
		return first
	}
	newer, err := strconv.ParseUint(second, 10, 64)
	if err != nil {
		return first
	}
	if newer > older {
		return second
	}
	return first
}

// triageReceipt builds the stored row for one fetched message, preserving
// source provenance on every verdict.
func triageReceipt(message Message, now time.Time) store.EmailReceipt {
	receipt := store.EmailReceipt{
		GmailMessageID: message.ID,
		ThreadID:       message.ThreadID,
		MessageDate:    "",
		Verdict:        DetectVerdict(message.From, message.Subject, message.Body),
		Provenance:     store.ReceiptProvenanceForEmail(),
		ScannedAt:      now.UTC().Format(time.RFC3339),
	}
	if !message.Date.IsZero() {
		receipt.MessageDate = message.Date.UTC().Format(time.RFC3339)
	}
	switch receipt.Verdict {
	case store.EmailReceiptVerdictReceipt, store.EmailReceiptVerdictRefund:
		receipt.FromAddress = strings.TrimSpace(message.From)
		if len(receipt.FromAddress) > 320 {
			receipt.FromAddress = receipt.FromAddress[:320]
		}
		receipt.Subject = strings.TrimSpace(message.Subject)
		if len(receipt.Subject) > 300 {
			receipt.Subject = receipt.Subject[:300]
		}
		extraction := ExtractReceipt(message, now)
		receipt.Merchant = extraction.Merchant
		receipt.ReceiptDate = extraction.ReceiptDate
		receipt.AmountText = extraction.AmountText
		receipt.Currency = extraction.Currency
		receipt.Reference = extraction.Reference
		receipt.Diagnostics = extraction.Diagnostics
		if extraction.HasAmount {
			receipt.AmountCents = &extraction.AmountCents
		}
		confidence := extraction.Confidence
		receipt.Confidence = &confidence
		receipt.Status = extractionStatus(receipt.Verdict, extraction)
	default:
		receipt.Status = store.EmailReceiptStatusReady
	}
	return receipt
}

func validTokenForScan(ctx context.Context, s *Service, st ScanStore) (string, error) {
	if s == nil || !s.Configured() {
		return "", ErrNotConfigured
	}
	credential, err := st.GetGmailCredential()
	if err != nil {
		return "", err
	}
	if !credential.Connected() {
		return "", ErrNotConnected
	}
	if credential.AccessToken != "" && s.config.now().Add(time.Minute).Unix() < credential.AccessExpiryUnix {
		return credential.AccessToken, nil
	}
	token, err := s.config.Exchange.Refresh(ctx, credential.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("gmail token refresh: %w", err)
	}
	if token.AccessToken == "" {
		return "", fmt.Errorf("gmail token refresh: provider returned no access token")
	}
	updated, err := st.UpdateGmailToken(token.AccessToken, token.Expiry.Unix(), token.RefreshToken)
	if err != nil {
		return "", err
	}
	return updated.AccessToken, nil
}

// ScanWith runs receipt discovery with the given fetcher. Production
// callers use Scan; tests inject a fake fetcher. Listing and cursor
// failures abort the scan without storing anything; per-message
// fetch/parse failures are isolated as failed rows with diagnostics and
// never fail the scan or touch financial state.
func (s *Service) ScanWith(ctx context.Context, st ScanStore, fetcher MessageFetcher) (ScanSummary, error) {
	summary := ScanSummary{}
	if fetcher == nil {
		return summary, fmt.Errorf("gmail scan: no message fetcher")
	}
	credential, err := st.GetGmailCredential()
	if err != nil {
		return summary, err
	}
	if !credential.Connected() {
		return summary, ErrNotConnected
	}
	token, err := validTokenForScan(ctx, s, st)
	if err != nil {
		return summary, err
	}
	now := s.config.now()
	window := WindowFor(credential, now)
	summary.Incremental = window.Incremental
	ids := []string{}
	latestHistory := ""
	for pageToken := ""; ; {
		if err := ctx.Err(); err != nil {
			return summary, err
		}
		var page MessagePage
		if window.Incremental {
			page, err = fetcher.ListSince(ctx, token, window.HistoryID, pageToken)
		} else {
			page, err = fetcher.ListRecent(ctx, token, window.After, pageToken)
		}
		if err != nil {
			return summary, fmt.Errorf("gmail scan list: %w", err)
		}
		ids = append(ids, page.IDs...)
		latestHistory = newerHistoryID(latestHistory, page.LatestHistoryID)
		summary.Listed = len(ids)
		if page.NextPageToken == "" {
			break
		}
		if len(ids) >= MaxMessagesPerScan*MaxListPages {
			summary.Truncated = true
			break
		}
		pageToken = page.NextPageToken
	}
	fetched := 0
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return summary, err
		}
		scanned, err := st.IsGmailMessageScanned(id)
		if err != nil {
			return summary, err
		}
		if scanned {
			summary.Skipped++
			continue
		}
		if fetched >= MaxMessagesPerScan {
			summary.Truncated = true
			continue
		}
		fetched++
		message, err := fetcher.GetMessage(ctx, token, id)
		if err != nil {
			failed := store.EmailReceipt{
				GmailMessageID: id,
				Verdict:        store.EmailReceiptVerdictFailed,
				Status:         store.EmailReceiptStatusNeedsReview,
				Diagnostics:    []string{"message fetch failed; retry the scan or disconnect Gmail"},
				Provenance:     store.ReceiptProvenanceForEmail(),
				ScannedAt:      now.UTC().Format(time.RFC3339),
			}
			if _, saveErr := st.SaveEmailReceipt(failed); saveErr != nil {
				return summary, saveErr
			}
			summary.Triaged++
			summary.Failed++
			continue
		}
		if message.ID == "" {
			message.ID = id
		}
		// Fetched messages establish the history cursor even when the
		// listing carries none, so the initial scan still engages
		// incremental follow-ups.
		latestHistory = newerHistoryID(latestHistory, message.HistoryID)
		stored, err := st.SaveEmailReceipt(triageReceipt(message, now))
		if err != nil {
			return summary, err
		}
		summary.Triaged++
		switch stored.Verdict {
		case store.EmailReceiptVerdictReceipt:
			summary.Receipts++
		case store.EmailReceiptVerdictRefund:
			summary.Refunds++
		case store.EmailReceiptVerdictFailed:
			summary.Failed++
		}
		if stored.Status == store.EmailReceiptStatusNeedsReview {
			summary.NeedsReview++
		}
	}
	cursor := latestHistory
	if cursor == "" || summary.Truncated {
		// A truncated scan keeps the stored cursor so the next scan
		// resumes with the untriaged messages instead of skipping them.
		// Stored triage rows still dedupe the repeat listing.
		cursor = credential.LastHistoryID
	}
	if _, err := st.SetGmailScanCursor(cursor, now.UTC().Format(time.RFC3339)); err != nil {
		return summary, err
	}
	return summary, nil
}

// Scan runs receipt discovery against Gmail. It requires a connected
// grant and configured OAuth client. Message access goes through the
// Service Fetcher seam when set (tests), else the production Gmail REST
// fetcher built from the configured HTTP client.
func (s *Service) Scan(ctx context.Context, st ScanStore) (ScanSummary, error) {
	if s == nil || !s.Configured() {
		return ScanSummary{}, ErrNotConfigured
	}
	fetcher := s.Fetcher
	if fetcher == nil {
		fetcher = newHTTPFetcher(s.config.client())
	}
	return s.ScanWith(ctx, st, fetcher)
}
