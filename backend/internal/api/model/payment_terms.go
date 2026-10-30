package model

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type termsBody struct {
	AccountID      string   `json:"accountId"`
	MinimumFixed   float64  `json:"minimumFixed"`
	MinimumPercent *float64 `json:"minimumPercent,omitempty"`
	DueDay         int      `json:"dueDay"`
	StatementDay   *int     `json:"statementDay,omitempty"`
}

func (b termsBody) toTerms() types.PaymentTerms {
	return types.PaymentTerms{
		AccountID: b.AccountID, MinimumFixed: b.MinimumFixed,
		MinimumPercent: b.MinimumPercent, DueDay: b.DueDay, StatementDay: b.StatementDay,
	}
}

type paymentTermsInput struct {
	Body termsBody `json:"body"`
}

type paymentTermsOutput struct {
	Body rowResultBody[types.PaymentTerms] `json:"body"`
}

func (s *handler) savePaymentTerms(_ context.Context, input *paymentTermsInput) (*paymentTermsOutput, error) {
	terms := input.Body.toTerms()
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		replaced := false
		for i, existing := range document.PaymentTerms {
			if existing.AccountID == terms.AccountID {
				document.PaymentTerms[i] = terms
				replaced = true
			}
		}
		if !replaced {
			document.PaymentTerms = append(document.PaymentTerms, terms)
		}
	}, func() (types.PaymentTerms, error) {
		return s.store.SavePaymentTerms(terms)
	})
	if err != nil {
		return nil, err
	}
	return &paymentTermsOutput{Body: rowResultBody[types.PaymentTerms]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deletePaymentTerms(_ context.Context, input *struct {
	AccountID string `path:"accountId"`
}) (*reorderOutput, error) {
	accountID := input.AccountID
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		kept := document.PaymentTerms[:0]
		for _, terms := range document.PaymentTerms {
			if terms.AccountID != accountID {
				kept = append(kept, terms)
			}
		}
		document.PaymentTerms = kept
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeletePaymentTerms(accountID)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
