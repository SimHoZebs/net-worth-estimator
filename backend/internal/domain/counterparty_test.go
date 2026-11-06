package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func counterpartyTransaction(source *string, destinations []string) *types.Transaction {
	return &types.Transaction{ID: "p", SourceAccountID: source, Destinations: destinations}
}

func TestCounterpartyMatrix(t *testing.T) {
	cases := []struct {
		name         string
		transaction  *types.Transaction
		inflow       bool
		outflow      bool
		transfer     bool
		sourced      bool
		externalDest bool
	}{
		{"external inflow", counterpartyTransaction(nil, []string{"checking"}), true, false, false, false, false},
		{"external outflow", counterpartyTransaction(strPtr("checking"), nil), false, true, false, true, true},
		{"transfer", counterpartyTransaction(strPtr("checking"), []string{"savings"}), false, false, true, true, false},
		{"nowhere", counterpartyTransaction(nil, nil), false, false, false, false, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsExternalInflow(testCase.transaction); got != testCase.inflow {
				t.Fatalf("inflow = %v, want %v", got, testCase.inflow)
			}
			if got := IsExternalOutflow(testCase.transaction); got != testCase.outflow {
				t.Fatalf("outflow = %v, want %v", got, testCase.outflow)
			}
			if got := IsInternalTransfer(testCase.transaction); got != testCase.transfer {
				t.Fatalf("transfer = %v, want %v", got, testCase.transfer)
			}
			if _, got := TransactionSourceAccount(testCase.transaction); got != testCase.sourced {
				t.Fatalf("sourced = %v, want %v", got, testCase.sourced)
			}
			if got := HasExternalDestination(testCase.transaction); got != testCase.externalDest {
				t.Fatalf("external destination = %v, want %v", got, testCase.externalDest)
			}
		})
	}
}

func TestTransactionSourceAccountReturnsID(t *testing.T) {
	id, ok := TransactionSourceAccount(counterpartyTransaction(strPtr("checking"), nil))
	if !ok || id != "checking" {
		t.Fatalf("source = %q, %v", id, ok)
	}
}
