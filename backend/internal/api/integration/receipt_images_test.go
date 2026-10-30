package integration

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
)

func TestReceiptImageReplacementHTTPBoundary(t *testing.T) {
	db := receiptAPIStore(t)
	source, _ := receiptmock.NewWithLatency(0)
	h := New(db, Config{ReceiptSource: source})
	r := decodeReceipt(t, receiptUpload(t, h, receiptmock.SampleImage))
	r = decodeReceipt(t, receiptRequest(h, "POST", "/v1/receipts/"+r.ID+"/extract", nil))
	r = decodeReceipt(t, receiptRequest(h, "PATCH", "/v1/receipts/"+r.ID, map[string]any{"revision": r.Revision, "details": r.Extraction.Details, "confirm": true}))
	path := "/v1/receipts/" + r.ID + "/image"
	fields := map[string]string{"revision": strconv.FormatInt(r.Revision, 10)}
	if w := receiptMultipartRequest(t, h, "PUT", path, fields, []byte("invalid image")); w.Code != 422 {
		t.Fatalf("invalid replace = %d %s", w.Code, w.Body.String())
	}
	kept := decodeReceipt(t, receiptRequest(h, "GET", "/v1/receipts/"+r.ID, nil))
	if kept.Confirmed == nil || kept.Revision != r.Revision {
		t.Fatal("invalid upload cleared old content")
	}
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	updated := decodeReceipt(t, receiptMultipartRequest(t, h, "PUT", path, fields, pixels.Bytes()))
	if updated.ID != r.ID || updated.Digest == r.Digest || updated.Revision != r.Revision+1 || updated.Extraction != nil || updated.Confirmed != nil || updated.Draft != nil || updated.Status != "attached" {
		t.Fatalf("replacement = %+v", updated)
	}
	if w := receiptMultipartRequest(t, h, "PUT", path, fields, pixels.Bytes()); w.Code != 409 {
		t.Fatalf("stale replace = %d %s", w.Code, w.Body.String())
	}
	got := receiptRequest(h, "GET", path, nil)
	if got.Code != 200 || bytes.Equal(got.Body.Bytes(), receiptmock.SampleImage) {
		t.Fatal("old image still served")
	}
	for _, length := range []int64{-1, receipts.MaxUploadBytes + 100000} {
		rq := httptest.NewRequest("PUT", path, bytes.NewReader(bytes.Repeat([]byte("x"), receipts.MaxUploadBytes+100000)))
		rq.ContentLength = length
		rq.Header.Set("Content-Type", "multipart/form-data; boundary=test")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, rq)
		if w.Code != 413 {
			t.Fatalf("replacement body limit = %d", w.Code)
		}
	}
}

func TestFinancialModelExposesReceiptLinksWithoutChangingRevision(t *testing.T) {
	db := receiptAPIStore(t)
	source, _ := receiptmock.NewWithLatency(0)
	h := New(db, Config{ReceiptSource: source})
	before := receiptRequest(h, "GET", "/v1/financial-model", nil)
	if before.Code != 200 {
		t.Fatalf("model status = %d", before.Code)
	}
	var empty struct {
		Revision     string         `json:"revision"`
		ReceiptLinks map[string]any `json:"receiptLinks"`
	}
	if err := json.Unmarshal(before.Body.Bytes(), &empty); err != nil {
		t.Fatal(err)
	}
	if len(empty.ReceiptLinks) != 0 {
		t.Fatalf("pre-upload links = %+v", empty.ReceiptLinks)
	}
	r := decodeReceipt(t, receiptUpload(t, h, receiptmock.SampleImage))
	after := receiptRequest(h, "GET", "/v1/financial-model", nil)
	if after.Code != 200 {
		t.Fatalf("model status = %d", after.Code)
	}
	type modelEnvelope struct {
		Revision     string              `json:"revision"`
		ReceiptLinks map[string][]string `json:"receiptLinks"`
	}
	var envelope modelEnvelope
	if err := json.Unmarshal(after.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	got := envelope
	if got.Revision != empty.Revision {
		t.Fatalf("receipt changed financial revision %q -> %q", empty.Revision, got.Revision)
	}
	links, ok := got.ReceiptLinks[receiptAPIPostingID]
	if !ok || len(links) != 1 || links[0] != r.ID {
		t.Fatalf("receipt links = %+v", got.ReceiptLinks)
	}
}
