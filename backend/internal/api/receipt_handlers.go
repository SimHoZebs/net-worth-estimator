package api

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type receiptIDInput struct {
	ID string `path:"id"`
}

type receiptOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Receipt     types.Receipt `json:"receipt"`
		Diagnostics []string      `json:"diagnostics"`
	}
}

func (s *Server) receiptResponse(receipt types.Receipt, err error) (*receiptOutput, error) {
	if err != nil {
		return nil, receiptAPIError(err)
	}
	// Decorate every response against the current saved posting, including a
	// review saved after that posting changed. View state is never persisted.
	receipt, err = s.Receipts.Get(receipt.ID)
	if err != nil {
		return nil, receiptAPIError(err)
	}
	output := &receiptOutput{CacheControl: "private, no-store"}
	output.Body.Receipt = receipt
	output.Body.Diagnostics = s.Receipts.Diagnostics(receipt)
	return output, nil
}

func receiptAPIError(err error) error {
	var failure *receipts.Error
	switch {
	case errors.Is(err, store.ErrReceiptNotFound):
		return huma.Error404NotFound("Receipt or posting not found")
	case errors.Is(err, store.ErrReceiptConflict):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, store.ErrReceiptDuplicate):
		return huma.Error409Conflict(err.Error())
	case errors.Is(err, store.ErrReceiptIneligible):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, store.ErrReceiptQuota):
		return huma.Error413RequestEntityTooLarge(err.Error())
	case errors.As(err, &failure):
		status := http.StatusUnprocessableEntity
		if failure.Code == "unavailable" {
			status = http.StatusServiceUnavailable
		}
		if failure.Code == "too-large" {
			status = http.StatusRequestEntityTooLarge
		}
		return huma.NewError(status, failure.Message)
	default:
		return huma.Error500InternalServerError("Receipt storage is temporarily unavailable")
	}
}

func (s *Server) listReceipts(_ context.Context, input *receiptIDInput) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Receipts            []types.Receipt `json:"receipts"`
		ExtractionAvailable bool            `json:"extractionAvailable"`
	}
}, error) {
	items, err := s.Receipts.List(input.ID)
	if err != nil {
		return nil, receiptAPIError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Receipts            []types.Receipt `json:"receipts"`
			ExtractionAvailable bool            `json:"extractionAvailable"`
		}
	}{CacheControl: "private, no-store"}
	output.Body.Receipts, output.Body.ExtractionAvailable = items, s.Receipts.Available()
	return output, nil
}

func (s *Server) attachReceipt(ctx context.Context, input *struct {
	RawBody huma.MultipartFormFiles[struct {
		PostingID string        `form:"postingId" required:"true" maxLength:"100"`
		Image     huma.FormFile `form:"image" contentType:"image/jpeg,image/png" required:"true"`
	}]
}) (*receiptOutput, error) {
	form := input.RawBody.Data()
	defer form.Image.Close()
	image, err := receipts.NormalizeImage(form.Image)
	if err != nil {
		return nil, receiptAPIError(err)
	}
	return s.receiptResponse(s.Receipts.Attach(ctx, form.PostingID, form.Image.Filename, image))
}

func (s *Server) getReceipt(_ context.Context, input *receiptIDInput) (*receiptOutput, error) {
	return s.receiptResponse(s.Receipts.Get(input.ID))
}

func (s *Server) replaceReceiptImage(ctx context.Context, input *struct {
	ID      string `path:"id"`
	RawBody huma.MultipartFormFiles[struct {
		Revision int64         `form:"revision" required:"true" minimum:"1"`
		Image    huma.FormFile `form:"image" contentType:"image/jpeg,image/png" required:"true"`
	}]
}) (*receiptOutput, error) {
	form := input.RawBody.Data()
	defer form.Image.Close()
	image, err := receipts.NormalizeImage(form.Image)
	if err != nil {
		return nil, receiptAPIError(err)
	}
	return s.receiptResponse(s.Receipts.ReplaceImage(ctx, input.ID, form.Revision, form.Image.Filename, image))
}

func (s *Server) reviewReceipt(_ context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		Revision int64                `json:"revision" minimum:"1"`
		Details  types.ReceiptDetails `json:"details"`
		Confirm  bool                 `json:"confirm"`
	}
}) (*receiptOutput, error) {
	return s.receiptResponse(s.Receipts.Review(input.ID, input.Body.Revision, input.Body.Details, input.Body.Confirm))
}

func (s *Server) extractReceipt(ctx context.Context, input *receiptIDInput) (*receiptOutput, error) {
	return s.receiptResponse(s.Receipts.Extract(ctx, input.ID))
}

func (s *Server) deleteReceipt(ctx context.Context, input *receiptIDInput) (*struct {
	Body struct {
		DeletedID string `json:"deletedId"`
	}
}, error) {
	if err := s.store.DeleteReceipt(ctx, input.ID); err != nil {
		return nil, receiptAPIError(err)
	}
	out := &struct {
		Body struct {
			DeletedID string `json:"deletedId"`
		}
	}{}
	out.Body.DeletedID = input.ID
	return out, nil
}

func (s *Server) getReceiptImage(ctx context.Context, input *struct {
	ID       string `path:"id"`
	Download bool   `query:"download" default:"false"`
}) (*huma.StreamResponse, error) {
	image, err := s.store.GetReceiptImage(ctx, input.ID)
	if err != nil {
		return nil, receiptAPIError(err)
	}
	return &huma.StreamResponse{Body: func(ctx huma.Context) {
		ctx.SetHeader("Content-Type", image.MediaType)
		ctx.SetHeader("Content-Length", strconv.Itoa(len(image.Bytes)))
		ctx.SetHeader("Cache-Control", "private, no-store")
		ctx.SetHeader("X-Content-Type-Options", "nosniff")
		if input.Download {
			extension := ".png"
			if image.MediaType == "image/jpeg" {
				extension = ".jpg"
			}
			ctx.SetHeader("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "receipt" + extension}))
		}
		ctx.SetStatus(http.StatusOK)
		_, _ = ctx.BodyWriter().Write(image.Bytes)
	}}, nil
}
