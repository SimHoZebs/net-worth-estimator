package receipts

import (
	"bytes"
	"io"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type handler struct {
	service *receipts.Service
	store   store.Store
}

// Register adds receipt operations to the shared Huma API.
func Register(api huma.API, service *receipts.Service, st store.Store) {
	s := &handler{service: service, store: st}
	upload := huma.Middlewares{receiptUploadLimit(api)}
	huma.Register(api, huma.Operation{OperationID: "list-receipts", Method: "GET", Path: "/v1/postings/{id}/receipts", Summary: "List private receipt evidence for a saved posting"}, s.listReceipts)
	huma.Register(api, huma.Operation{OperationID: "attach-receipt", Method: "POST", Path: "/v1/receipts", Summary: "Attach a private receipt image", MaxBodyBytes: receipts.MaxUploadBytes + (64 << 10), Middlewares: upload}, s.attachReceipt)
	receiptMultipartSpec(api.OpenAPI().Paths["/v1/receipts"].Post)
	huma.Register(api, huma.Operation{OperationID: "replace-receipt-image", Method: "PUT", Path: "/v1/receipts/{id}/image", Summary: "Replace receipt image and clear receipt content", MaxBodyBytes: receipts.MaxUploadBytes + (64 << 10), Middlewares: upload}, s.replaceReceiptImage)
	receiptMultipartSpec(api.OpenAPI().Paths["/v1/receipts/{id}/image"].Put)
	huma.Register(api, huma.Operation{OperationID: "get-receipt", Method: "GET", Path: "/v1/receipts/{id}", Summary: "Read receipt evidence and review details"}, s.getReceipt)
	huma.Register(api, huma.Operation{OperationID: "review-receipt", Method: "PATCH", Path: "/v1/receipts/{id}", Summary: "Save or confirm reviewed receipt details"}, s.reviewReceipt)
	huma.Register(api, huma.Operation{OperationID: "extract-receipt", Method: "POST", Path: "/v1/receipts/{id}/extract", Summary: "Extract receipt evidence using the configured source"}, s.extractReceipt)
	huma.Register(api, huma.Operation{OperationID: "delete-receipt", Method: "DELETE", Path: "/v1/receipts/{id}", Summary: "Delete private receipt evidence"}, s.deleteReceipt)
	huma.Register(api, huma.Operation{OperationID: "get-receipt-image", Method: "GET", Path: "/v1/receipts/{id}/image", Summary: "Read a private receipt image", Responses: map[string]*huma.Response{
		"200": {Description: "Private receipt pixels", Content: map[string]*huma.MediaType{
			"image/png":  {Schema: &huma.Schema{Type: "string", Format: "binary"}},
			"image/jpeg": {Schema: &huma.Schema{Type: "string", Format: "binary"}},
		}},
	}}, s.getReceiptImage)
}

func receiptMultipartSpec(operation *huma.Operation) {
	content := operation.RequestBody.Content["multipart/form-data"]
	// Scalar fields use standard string encoding, not file parts.
	for name := range content.Encoding {
		if name != "image" {
			delete(content.Encoding, name)
		}
	}
	// Raw file bytes have no content transfer encoding. Keep binary format.
	content.Schema.Properties["image"].ContentEncoding = ""
}

// Huma's multipart parser does not apply MaxBodyBytes. Bound the entire body,
// including chunked requests, before it reaches that parser. Identity and the
// API write guard run first. Multipart temp files are removed after parsing.
func receiptUploadLimit(api huma.API) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		r, _ := humachi.Unwrap(ctx)
		const limit = receipts.MaxUploadBytes + (64 << 10)
		if r.ContentLength > limit {
			_ = huma.WriteErr(api, ctx, http.StatusRequestEntityTooLarge, "Choose a receipt image smaller than 10 MiB.")
			return
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
		_ = r.Body.Close()
		if err != nil {
			_ = huma.WriteErr(api, ctx, http.StatusBadRequest, "The receipt upload could not be read.")
			return
		}
		if len(data) > limit {
			_ = huma.WriteErr(api, ctx, http.StatusRequestEntityTooLarge, "Choose a receipt image smaller than 10 MiB.")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(data))
		defer func() {
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
			}
		}()
		next(ctx)
	}
}
