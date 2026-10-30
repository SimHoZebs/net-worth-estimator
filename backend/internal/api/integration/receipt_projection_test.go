package integration

import (
	"encoding/json"
	"testing"

	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestReceiptEvidenceDoesNotInvalidateProjectionArtifacts(t *testing.T) {
	db := receiptAPIStore(t)
	source, err := receiptmock.NewWithLatency(0)
	if err != nil {
		t.Fatal(err)
	}
	h := New(db, Config{ReceiptSource: source})
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-10-20", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables()}
	deterministic, _ := json.Marshal(projectionRequestBody{Settings: settings, Range: fullSpanRange()})
	seed := int64(42)
	stochastic, _ := json.Marshal(map[string]any{"settings": settings, "config": types.StochasticConfig{RunCount: 3, Seed: &seed}})
	first := rangeRequest(t, h, deterministic)
	if first.Code != 200 || first.Header().Get("Projection-Source") != projectionSourceComputed {
		t.Fatalf("base=%d %s", first.Code, first.Body.String())
	}
	rangeFirst := postStochastic(t, h, stochastic)
	firstEvents := sseEvents(t, rangeFirst.Body.String())
	if rangeFirst.Code != 200 || len(firstEvents["result"]) != 1 {
		t.Fatalf("range=%d %s", rangeFirst.Code, rangeFirst.Body.String())
	}
	r := decodeReceipt(t, receiptUpload(t, h, receiptmock.SampleImage))
	r = decodeReceipt(t, receiptRequest(h, "POST", "/v1/receipts/"+r.ID+"/extract", nil))
	r = decodeReceipt(t, receiptRequest(h, "PATCH", "/v1/receipts/"+r.ID, map[string]any{"revision": r.Revision, "details": r.Extraction.Details, "confirm": true}))
	if got := receiptRequest(h, "DELETE", "/v1/receipts/"+r.ID, nil); got.Code != 200 {
		t.Fatal(got.Body.String())
	}
	second := rangeRequest(t, h, deterministic)
	if second.Header().Get("Projection-Source") != projectionSourceStored || second.Body.String() != first.Body.String() {
		t.Fatal("receipt invalidated deterministic result or identity")
	}
	rangeSecond := postStochastic(t, h, stochastic)
	secondEvents := sseEvents(t, rangeSecond.Body.String())
	if rangeSecond.Header().Get("Projection-Source") != projectionSourceStored || len(secondEvents["result"]) != 1 || secondEvents["result"][0] != firstEvents["result"][0] {
		t.Fatal("receipt invalidated seeded stochastic result or identity")
	}
}
