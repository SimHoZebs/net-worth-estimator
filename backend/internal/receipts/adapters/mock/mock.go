// Package mock is a deterministic local adapter for the receipt source contract.
// Fixture identities never escape into the application API or receipt workflow.
package mock

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

//go:embed testdata/market.png
var SampleImage []byte

//go:embed testdata/market.json
var sampleResult []byte

type Extractor struct {
	digest  string
	latency time.Duration
}

const defaultLatency = 2 * time.Second

func New() (*receipts.Source, error) {
	return NewWithLatency(defaultLatency)
}

// NewWithLatency keeps simulated timing inside the adapter. Unit tests select
// zero latency without changing the service or the source contract.
func NewWithLatency(latency time.Duration) (*receipts.Source, error) {
	if latency < 0 {
		return nil, fmt.Errorf("mock receipt latency must be nonnegative")
	}
	extractor, err := NewExtractor()
	if err != nil {
		return nil, err
	}
	extractor.latency = latency
	return receipts.NewSource(types.ReceiptProvenance{Producer: "local-sample", Version: "1", Simulated: true}, extractor)
}

func NewExtractor() (*Extractor, error) {
	image, err := receipts.NormalizeImage(bytes.NewReader(SampleImage))
	if err != nil {
		return nil, err
	}
	return &Extractor{digest: image.Digest}, nil
}

func (e *Extractor) Extract(ctx context.Context, input receipts.ExtractionInput) (receipts.ExtractionResult, error) {
	if err := ctx.Err(); err != nil {
		return receipts.ExtractionResult{}, err
	}
	if e.latency > 0 {
		timer := time.NewTimer(e.latency)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return receipts.ExtractionResult{}, ctx.Err()
		case <-timer.C:
		}
	}
	if input.Image.Digest != e.digest {
		return receipts.ExtractionResult{}, receipts.Failure("unavailable", "Extraction is unavailable for this image. Enter receipt details manually.", false)
	}
	var details types.ReceiptDetails
	if err := json.Unmarshal(sampleResult, &details); err != nil {
		return receipts.ExtractionResult{}, err
	}
	confidence := 0.96
	return receipts.ExtractionResult{Details: details, Confidence: &confidence, Diagnostics: []string{}}, nil
}
