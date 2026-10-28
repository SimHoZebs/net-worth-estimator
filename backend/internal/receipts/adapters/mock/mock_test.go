package mock

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
)

func TestSimulatedLatencyAndCancellation(t *testing.T) {
	for _, name := range []string{"success", "deadline", "canceled", "unknown-image", "zero-latency"} {
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				extractor, err := NewExtractor()
				if err != nil {
					t.Fatal(err)
				}
				extractor.latency = defaultLatency
				image, err := receipts.NormalizeImage(bytes.NewReader(SampleImage))
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				wantDuration := defaultLatency
				var wantError error
				switch name {
				case "deadline":
					var cancelDeadline context.CancelFunc
					ctx, cancelDeadline = context.WithTimeout(ctx, time.Second)
					defer cancelDeadline()
					wantDuration, wantError = time.Second, context.DeadlineExceeded
				case "canceled":
					go func() { time.Sleep(500 * time.Millisecond); cancel() }()
					wantDuration, wantError = 500*time.Millisecond, context.Canceled
				case "unknown-image":
					image.Digest = "unknown"
				case "zero-latency":
					extractor.latency, wantDuration = 0, 0
				}
				started := time.Now()
				result, err := extractor.Extract(ctx, receipts.ExtractionInput{Image: image})
				if elapsed := time.Since(started); elapsed != wantDuration {
					t.Fatalf("elapsed = %v, want %v", elapsed, wantDuration)
				}
				if name == "unknown-image" {
					var failure *receipts.Error
					if !errors.As(err, &failure) || failure.Code != "unavailable" {
						t.Fatalf("unknown image = %v", err)
					}
				} else if !errors.Is(err, wantError) {
					t.Fatalf("extraction error = %v, want %v", err, wantError)
				}
				if err == nil && result.Details.Merchant != "Sample Market" {
					t.Fatal("missing fixture result")
				}
				if err != nil && result.Details.Merchant != "" {
					t.Fatal("failed extraction returned receipt details")
				}
			})
		})
	}
}

func TestRejectsNegativeLatency(t *testing.T) {
	if _, err := NewWithLatency(-time.Second); err == nil {
		t.Fatal("negative latency accepted")
	}
}
