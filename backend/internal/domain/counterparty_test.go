package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func counterpartyPosting(source *string, destinations []string) *types.Posting {
	return &types.Posting{ID: "p", SourceAccountID: source, Destinations: destinations}
}

func TestCounterpartyMatrix(t *testing.T) {
	cases := []struct {
		name         string
		posting      *types.Posting
		inflow       bool
		outflow      bool
		transfer     bool
		sourced      bool
		externalDest bool
	}{
		{"external inflow", counterpartyPosting(nil, []string{"checking"}), true, false, false, false, false},
		{"external outflow", counterpartyPosting(strPtr("checking"), nil), false, true, false, true, true},
		{"transfer", counterpartyPosting(strPtr("checking"), []string{"savings"}), false, false, true, true, false},
		{"nowhere", counterpartyPosting(nil, nil), false, false, false, false, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsExternalInflow(testCase.posting); got != testCase.inflow {
				t.Fatalf("inflow = %v, want %v", got, testCase.inflow)
			}
			if got := IsExternalOutflow(testCase.posting); got != testCase.outflow {
				t.Fatalf("outflow = %v, want %v", got, testCase.outflow)
			}
			if got := IsInternalTransfer(testCase.posting); got != testCase.transfer {
				t.Fatalf("transfer = %v, want %v", got, testCase.transfer)
			}
			if _, got := PostingSourceAccount(testCase.posting); got != testCase.sourced {
				t.Fatalf("sourced = %v, want %v", got, testCase.sourced)
			}
			if got := HasExternalDestination(testCase.posting); got != testCase.externalDest {
				t.Fatalf("external destination = %v, want %v", got, testCase.externalDest)
			}
		})
	}
}

func TestPostingSourceAccountReturnsID(t *testing.T) {
	id, ok := PostingSourceAccount(counterpartyPosting(strPtr("checking"), nil))
	if !ok || id != "checking" {
		t.Fatalf("source = %q, %v", id, ok)
	}
}
