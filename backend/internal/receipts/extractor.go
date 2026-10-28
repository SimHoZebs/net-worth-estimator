// Package receipts owns receipt evidence independently of financial simulation.
package receipts

import (
	"context"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ReceiptExtractor is the source boundary. Adapters normalize their own wire
// formats and asynchronous provider lifecycle behind this single operation.
type ReceiptExtractor interface {
	Extract(context.Context, ExtractionInput) (ExtractionResult, error)
}

type ExtractionInput struct {
	Image     types.ReceiptImage
	RequestID string
	// ScopeID is an internal tenant key for source policy and private operation
	// state. An adapter must not send it as part of a provider's receipt input.
	ScopeID string
}

type ExtractionResult struct {
	Details     types.ReceiptDetails
	Confidence  *float64
	Diagnostics []string
}

// Error contains application-owned recovery information, never provider text.
type Error struct{ types.ReceiptProblem }

func (e *Error) Error() string { return e.Message }

func Failure(code, message string, retryable bool) *Error {
	return &Error{ReceiptProblem: types.ReceiptProblem{Code: code, Message: message, Retryable: retryable}}
}

// Source binds immutable cache/provenance identity to an injected adapter.
// Its limiter is shared by all plan-scoped services using this source.
type Source struct {
	identity  types.ReceiptProvenance
	extractor ReceiptExtractor
	slots     chan struct{}
}

func NewSource(identity types.ReceiptProvenance, extractor ReceiptExtractor) (*Source, error) {
	if identity.Producer == "" || identity.Version == "" || extractor == nil {
		return nil, fmt.Errorf("receipt source requires identity, version, and extractor")
	}
	return &Source{identity: identity, extractor: extractor, slots: make(chan struct{}, 2)}, nil
}

func (s *Source) extract(ctx context.Context, input ExtractionInput) (ExtractionResult, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return ExtractionResult{}, ctx.Err()
	}
	return s.extractor.Extract(ctx, input)
}

func extractionProblem(err error) types.ReceiptProblem {
	var failure *Error
	if errors.As(err, &failure) {
		return failure.ReceiptProblem
	}
	if errors.Is(err, context.Canceled) {
		return Failure("canceled", "Extraction was canceled. Retry or enter receipt details manually.", true).ReceiptProblem
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Failure("timeout", "Extraction timed out. Retry or enter receipt details manually.", true).ReceiptProblem
	}
	return Failure("unavailable", "Extraction is unavailable. Retry or enter receipt details manually.", true).ReceiptProblem
}
