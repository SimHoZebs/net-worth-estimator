package receipts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type Repository interface {
	store.ReceiptStore
	LoadDocument() (*types.FinancialModelDocument, error)
}

type Service struct {
	repository Repository
	source     *Source
	scope      string
}

const extractionTimeout = 45 * time.Second
const extractionLease = time.Minute

// receiptView derives recovery state without a write or a provider request.
func receiptView(receipt types.Receipt, posting types.Posting) types.Receipt {
	receipt.Stale = receipt.PostingFingerprint != store.PostingReceiptFingerprint(posting)
	if receipt.Status == "extracting" && time.Since(time.UnixMilli(receipt.ExtractionStartedAt)) >= extractionLease {
		receipt.Status = "interrupted"
	}
	return receipt
}

func NewService(repository Repository, source *Source, scope string) *Service {
	return &Service{repository: repository, source: source, scope: scope}
}

func (s *Service) Available() bool { return s.source != nil }

func (s *Service) Attach(ctx context.Context, postingID, filename string, image types.ReceiptImage) (types.Receipt, error) {
	return s.repository.CreateReceipt(ctx, postingID, receiptFilename(filename), image)
}

func (s *Service) ReplaceImage(ctx context.Context, id string, revision int64, filename string, image types.ReceiptImage) (types.Receipt, error) {
	return s.repository.ReplaceReceiptImage(ctx, id, revision, receiptFilename(filename), image)
}

func receiptFilename(filename string) string {
	filename = filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	if len(filename) > 120 || strings.TrimSpace(filename) == "" || strings.ContainsAny(filename, "\r\n\x00") {
		filename = "receipt"
	}
	return filename
}

func (s *Service) Get(id string) (types.Receipt, error) {
	receipt, err := s.repository.GetReceipt(id)
	if err != nil {
		return receipt, err
	}
	posting, err := s.posting(receipt.PostingID)
	if err != nil {
		return receipt, err
	}
	return receiptView(receipt, posting), nil
}

func (s *Service) List(postingID string) ([]types.Receipt, error) {
	items, err := s.repository.ListReceipts(postingID)
	if err != nil {
		return nil, err
	}
	posting, err := s.posting(postingID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i] = receiptView(items[i], posting)
	}
	return items, nil
}

// ListLinks is the stored reverse lookup: posting ID to its receipt IDs,
// read from the posting row. Receipt writes maintain the field in the same
// transaction as the receipt row.
func (s *Service) ListLinks() (map[string][]string, error) {
	return s.repository.ListPostingReceiptIDs()
}

func (s *Service) posting(id string) (types.Posting, error) {
	document, err := s.repository.LoadDocument()
	if err != nil {
		return types.Posting{}, err
	}
	if document != nil {
		for _, posting := range document.Postings {
			if posting.ID == id {
				return posting, nil
			}
		}
	}
	return types.Posting{}, store.ErrReceiptNotFound
}

func (s *Service) Review(id string, revision int64, details types.ReceiptDetails, confirm bool) (types.Receipt, error) {
	if err := types.ValidateReceiptDetails(details); err != nil {
		return types.Receipt{}, Failure("invalid-input", err.Error(), false)
	}
	if confirm && (strings.TrimSpace(details.Merchant) == "" || details.Currency != "USD" || details.Date == "" || details.TotalCents == nil) {
		return types.Receipt{}, Failure("invalid-input", "Merchant, date, USD currency, and total are required to confirm a receipt.", false)
	}
	receipt, err := s.repository.GetReceipt(id)
	if err != nil {
		return receipt, err
	}
	if receipt.Revision != revision {
		return receipt, store.ErrReceiptConflict
	}
	if receipt.Draft == nil {
		if receipt.Confirmed != nil {
			receipt.DraftProvenance = receipt.ConfirmedProvenance
		} else if receipt.Extraction != nil {
			provenance := receipt.Extraction.Provenance
			receipt.DraftProvenance = &provenance
		}
	}
	receipt.Draft = &details
	if confirm {
		posting, err := s.posting(receipt.PostingID)
		if err != nil {
			return receipt, err
		}
		receipt.Confirmed = &details
		receipt.ConfirmedProvenance = receipt.DraftProvenance
		receipt.PostingFingerprint = store.PostingReceiptFingerprint(posting)
	}
	return s.repository.SaveReceipt(receipt, revision)
}

func (s *Service) Extract(ctx context.Context, id string) (types.Receipt, error) {
	receipt, err := s.repository.GetReceipt(id)
	if err != nil {
		return receipt, err
	}
	if s.source == nil {
		return types.Receipt{}, Failure("unavailable", "Extraction is not configured. Enter receipt details manually.", false)
	}
	if receipt.Status == "extracting" && time.Since(time.UnixMilli(receipt.ExtractionStartedAt)) < extractionLease {
		return receipt, store.ErrReceiptConflict
	}
	if receipt.Extraction != nil && receipt.Extraction.Provenance == s.source.identity {
		return s.Get(id)
	}
	image, err := s.repository.GetReceiptImage(ctx, id)
	if err != nil {
		return receipt, err
	}
	started := time.Now().UnixMilli()
	receipt.Status, receipt.Problem, receipt.ExtractionStartedAt = "extracting", nil, started
	receipt, err = s.repository.SaveReceipt(receipt, receipt.Revision)
	if err != nil {
		return receipt, err
	}
	ctx, cancel := context.WithTimeout(ctx, extractionTimeout)
	defer cancel()
	requestKey := sha256.Sum256([]byte(s.scope + ":" + receipt.ID + ":" + image.Digest + ":" + s.source.identity.Producer + ":" + s.source.identity.Version))
	result, extractionErr := s.source.extract(ctx, ExtractionInput{Image: image, RequestID: hex.EncodeToString(requestKey[:]), ScopeID: s.scope})
	if ctx.Err() != nil {
		extractionErr = ctx.Err()
	}
	if extractionErr == nil {
		extractionErr = validateResult(result)
	}
	// Merge completion with the latest user review, never a pre-request snapshot.
	for attempt := 0; attempt < 5; attempt++ {
		current, err := s.repository.GetReceipt(id)
		if err != nil {
			return current, err
		}
		if current.ExtractionStartedAt != started || current.Digest != image.Digest {
			return current, store.ErrReceiptConflict
		}
		current.ExtractionStartedAt = 0
		if extractionErr != nil {
			problem := extractionProblem(extractionErr)
			current.Status, current.Problem = "failed", &problem
		} else {
			current.Status, current.Problem = "ready", nil
			current.Extraction = &types.ReceiptExtraction{Details: result.Details, Provenance: s.source.identity, Confidence: result.Confidence, Diagnostics: result.Diagnostics}
			if current.Extraction.Diagnostics == nil {
				current.Extraction.Diagnostics = []string{}
			}
		}
		saved, err := s.repository.SaveReceipt(current, current.Revision)
		if errors.Is(err, store.ErrReceiptConflict) {
			continue
		}
		return saved, err
	}
	return types.Receipt{}, store.ErrReceiptConflict
}

func validateResult(result ExtractionResult) error {
	invalid := func() error {
		return Failure("invalid-result", "The extraction result was invalid. Enter receipt details manually or retry.", true)
	}
	if types.ValidateReceiptDetails(result.Details) != nil || len(result.Diagnostics) > 20 {
		return invalid()
	}
	for _, diagnostic := range result.Diagnostics {
		if len(diagnostic) > 500 {
			return invalid()
		}
	}
	if result.Confidence != nil && (math.IsNaN(*result.Confidence) || *result.Confidence < 0 || *result.Confidence > 1) {
		return invalid()
	}
	return nil
}

func (s *Service) Diagnostics(receipt types.Receipt) []string {
	details := receipt.Draft
	if details == nil {
		details = receipt.Confirmed
	}
	if details == nil && receipt.Extraction != nil {
		details = &receipt.Extraction.Details
	}
	out := []string{}
	if receipt.Extraction != nil && receipt.Extraction.Confidence != nil && *receipt.Extraction.Confidence < 0.8 {
		out = append(out, "The source reports low confidence. Verify the receipt details.")
	}
	if receipt.Stale {
		out = append(out, "The saved transaction changed. Review the receipt against its current values.")
	}
	if details == nil {
		return out
	}
	if details.Currency == "" {
		out = append(out, "Receipt currency is unknown.")
	}
	if details.TotalCents == nil {
		out = append(out, "Receipt total is unknown.")
		return out
	}
	posting, err := s.posting(receipt.PostingID)
	if err == nil && posting.Amount.Resolver == "expression" && len(posting.Amount.Inputs) == 0 {
		// Only a finite literal is comparable. Calculated amounts remain unknown.
		if expression, ok := posting.Amount.Config["expression"].(string); ok {
			if amount, err := strconv.ParseFloat(strings.TrimSpace(expression), 64); err == nil && !math.IsNaN(amount) && !math.IsInf(amount, 0) && math.Abs(amount*100-float64(*details.TotalCents)) >= 1 {
				out = append(out, "The receipt total differs from the saved transaction amount.")
			}
		}
	}
	if len(details.Items) > 0 {
		var sum int64
		complete := true
		for _, item := range details.Items {
			if item.TotalCents == nil {
				complete = false
				break
			}
			sum += *item.TotalCents
		}
		if complete {
			for _, value := range []*int64{details.TaxCents, details.TipCents} {
				if value != nil {
					sum += *value
				}
			}
			if details.DiscountCents != nil {
				sum -= *details.DiscountCents
			}
			if sum != *details.TotalCents {
				out = append(out, "Item totals, tax, tip, and discounts do not reconcile with the receipt total.")
			}
		}
	}
	return out
}
