package types

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// ReceiptDetails are evidence, not simulation inputs. Money uses exact USD cents.
type ReceiptDetails struct {
	Merchant      string        `json:"merchant" maxLength:"200"`
	Date          string        `json:"date" maxLength:"10"`
	Currency      string        `json:"currency" maxLength:"3"`
	TotalCents    *int64        `json:"totalCents"`
	SubtotalCents *int64        `json:"subtotalCents"`
	TaxCents      *int64        `json:"taxCents"`
	TipCents      *int64        `json:"tipCents"`
	DiscountCents *int64        `json:"discountCents"`
	Items         []ReceiptItem `json:"items" maxItems:"200"`
}

type ReceiptItem struct {
	Description    string   `json:"description" maxLength:"300"`
	Quantity       *float64 `json:"quantity"`
	UnitPriceCents *int64   `json:"unitPriceCents"`
	TotalCents     *int64   `json:"totalCents"`
	Category       string   `json:"category" maxLength:"80"`
}

type ReceiptProvenance struct {
	Producer  string `json:"producer"`
	Version   string `json:"version"`
	Simulated bool   `json:"simulated"`
}

type ReceiptExtraction struct {
	Details     ReceiptDetails    `json:"details"`
	Provenance  ReceiptProvenance `json:"provenance"`
	Confidence  *float64          `json:"confidence"`
	Diagnostics []string          `json:"diagnostics"`
}

type ReceiptProblem struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	Retryable         bool   `json:"retryable"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

type Receipt struct {
	ID                  string             `json:"id"`
	PostingID           string             `json:"postingId"`
	Filename            string             `json:"filename"`
	MediaType           string             `json:"mediaType"`
	Size                int64              `json:"size"`
	Digest              string             `json:"digest"`
	CreatedAt           string             `json:"createdAt"`
	Revision            int64              `json:"revision"`
	Status              string             `json:"status"`
	ExtractionStartedAt int64              `json:"extractionStartedAt,omitempty"`
	Extraction          *ReceiptExtraction `json:"extraction,omitempty"`
	Draft               *ReceiptDetails    `json:"draft,omitempty"`
	Confirmed           *ReceiptDetails    `json:"confirmed,omitempty"`
	DraftProvenance     *ReceiptProvenance `json:"draftProvenance,omitempty"`
	ConfirmedProvenance *ReceiptProvenance `json:"confirmedProvenance,omitempty"`
	Problem             *ReceiptProblem    `json:"problem,omitempty"`
	PostingFingerprint  string             `json:"postingFingerprint"`
	Stale               bool               `json:"stale"`
}

// ReceiptImage never participates in model serialization or receipt list reads.
type ReceiptImage struct {
	Bytes     []byte
	MediaType string
	Digest    string
}

func ValidateReceiptDetails(d ReceiptDetails) error {
	if len(d.Merchant) > 200 || len(d.Items) > 200 {
		return fmt.Errorf("receipt has too many items or an overlong merchant")
	}
	if d.Date != "" {
		if _, err := time.Parse(time.DateOnly, d.Date); err != nil {
			return fmt.Errorf("receipt date must be YYYY-MM-DD")
		}
	}
	if d.Currency != "" && d.Currency != "USD" {
		return fmt.Errorf("only USD receipt details are supported")
	}
	validMoney := func(value *int64) bool { return value == nil || (*value >= 0 && *value <= 1_000_000_000_000) }
	for _, value := range []*int64{d.TotalCents, d.SubtotalCents, d.TaxCents, d.TipCents, d.DiscountCents} {
		if !validMoney(value) {
			return fmt.Errorf("receipt amounts must be nonnegative USD cents")
		}
	}
	for _, item := range d.Items {
		if len(item.Description) > 300 || strings.TrimSpace(item.Description) == "" || len(item.Category) > 80 {
			return fmt.Errorf("receipt items require a description of at most 300 characters and category of at most 80 characters")
		}
		if item.Quantity != nil && (math.IsNaN(*item.Quantity) || math.IsInf(*item.Quantity, 0) || *item.Quantity <= 0 || *item.Quantity > 1e9) {
			return fmt.Errorf("item quantity must be finite and positive")
		}
		if !validMoney(item.UnitPriceCents) || !validMoney(item.TotalCents) {
			return fmt.Errorf("item amounts must be nonnegative USD cents")
		}
	}
	return nil
}
