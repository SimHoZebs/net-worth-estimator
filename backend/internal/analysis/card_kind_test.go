package analysis

import (
	"context"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func cardKindAccount() types.AnalysisAccount {
	return types.AnalysisAccount{
		AccountID:   "bridge-card",
		LinkedID:    "model-card",
		Name:        "Chase Sapphire",
		Institution: "",
		Kind:        "cash",
	}
}

func cardKindSnapshot(account types.AnalysisAccount, ids ...string) types.AnalysisSnapshot {
	transactions := make([]types.AnalysisTransaction, 0, len(ids))
	for _, id := range ids {
		transactions = append(transactions, types.AnalysisTransaction{TransactionID: id, AccountID: account.AccountID})
	}
	return types.AnalysisSnapshot{Accounts: []types.AnalysisAccount{account}, Transactions: transactions}
}

func TestCardKindIssuerNameList(t *testing.T) {
	for _, test := range []struct {
		name, institution, issuer string
	}{
		{"Chase Sapphire", "", "chase"},
		{"AMEX Gold", "", "american-express"},
		{"Citi Double Cash", "", "citi"},
		{"Capital One Venture", "", "capital-one"},
		{"Wells Fargo Active Cash", "", "wells-fargo"},
		{"", "Discover Bank", "discover"},
		{"Local Corner Bank", "", ""},
		{"12345", "", ""},
	} {
		t.Run(test.name+"|"+test.institution, func(t *testing.T) {
			issuer, ok := cardIssuerFor(types.AnalysisAccount{Name: test.name, Institution: test.institution})
			if ok != (test.issuer != "") || issuer != test.issuer {
				t.Fatalf("issuer=%q ok=%v want %q", issuer, ok, test.issuer)
			}
		})
	}
}

func TestCardKindRequiresNonNameSignal(t *testing.T) {
	detector := CardKind{}
	for _, test := range []struct {
		name         string
		account      types.AnalysisAccount
		want         int
		wantStrength string
		wantCodes    []string
	}{
		{
			name:    "issuer name alone is not enough",
			account: cardKindAccount(),
			want:    0,
		},
		{
			name: "bridge type alone qualifies",
			account: func() types.AnalysisAccount {
				account := cardKindAccount()
				account.Name = "Local Corner Bank"
				account.ExtraType = "credit_card"
				return account
			}(),
			want:         1,
			wantStrength: "moderate",
			wantCodes:    []string{"card-kind.bridge-type"},
		},
		{
			name: "debt balance alone qualifies",
			account: func() types.AnalysisAccount {
				account := cardKindAccount()
				account.Name = "Local Corner Bank"
				account.DebtLike = true
				return account
			}(),
			want:         1,
			wantStrength: "moderate",
			wantCodes:    []string{"card-kind.debt-balance"},
		},
		{
			name: "both non-name signals are strong and include the issuer basis",
			account: func() types.AnalysisAccount {
				account := cardKindAccount()
				account.ExtraType = "CREDIT-CARD"
				account.DebtLike = true
				return account
			}(),
			want:         1,
			wantStrength: "strong",
			wantCodes:    []string{"card-kind.bridge-type", "card-kind.debt-balance", "card-kind.issuer-name"},
		},
		{
			name: "declared credit card needs no suggestion",
			account: func() types.AnalysisAccount {
				account := cardKindAccount()
				account.Kind = "credit_card"
				account.ExtraType = "credit_card"
				account.DebtLike = true
				return account
			}(),
			want: 0,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := detector.Analyze(context.Background(), cardKindSnapshot(test.account, "tx-b", "tx-a"))
			if err != nil || len(result) != test.want {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if test.want == 0 {
				return
			}
			finding := result[0]
			if finding.AccountID != "model-card" || finding.TransactionID != "tx-a" || finding.Kind != "card-kind" || finding.Strength != test.wantStrength {
				t.Fatalf("finding=%+v", finding)
			}
			if finding.Provider != "chase" && test.account.Name == "Chase Sapphire" {
				t.Fatalf("issuer basis missing: %+v", finding)
			}
			codes := []string{}
			for _, evidence := range finding.Evidence {
				codes = append(codes, evidence.Code)
				if len(evidence.Reason) == 0 || len(evidence.TransactionIDs) == 0 {
					t.Fatalf("empty evidence basis: %+v", evidence)
				}
			}
			if len(codes) != len(test.wantCodes) {
				t.Fatalf("codes=%v want %v", codes, test.wantCodes)
			}
			for i := range codes {
				if codes[i] != test.wantCodes[i] {
					t.Fatalf("codes=%v want %v", codes, test.wantCodes)
				}
			}
		})
	}
}

func TestCardKindFindingsArePerAccountAndCancellable(t *testing.T) {
	first := types.AnalysisAccount{AccountID: "bridge-a", LinkedID: "model-a", ExtraType: "credit_card"}
	second := types.AnalysisAccount{AccountID: "bridge-b", LinkedID: "model-b", DebtLike: true}
	input := types.AnalysisSnapshot{
		Accounts: []types.AnalysisAccount{second, first},
		Transactions: []types.AnalysisTransaction{
			{TransactionID: "b-1", AccountID: "bridge-b"},
			{TransactionID: "a-2", AccountID: "bridge-a"},
			{TransactionID: "a-1", AccountID: "bridge-a"},
			{TransactionID: "orphan", AccountID: "bridge-unknown"},
		},
	}
	result, err := (CardKind{}).Analyze(context.Background(), input)
	if err != nil || len(result) != 2 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if result[0].AccountID != "model-a" || result[0].TransactionID != "a-1" || result[1].AccountID != "model-b" || result[1].TransactionID != "b-1" {
		t.Fatalf("per-account findings=%+v", result)
	}
	// A bridge account with no link still yields a usable account ID.
	unlinked := types.AnalysisAccount{AccountID: "bridge-c", ExtraType: "card"}
	input.Accounts = append(input.Accounts, unlinked)
	input.Transactions = append(input.Transactions, types.AnalysisTransaction{TransactionID: "c-1", AccountID: "bridge-c"})
	result, err = (CardKind{}).Analyze(context.Background(), input)
	if err != nil || len(result) != 3 {
		t.Fatalf("unlinked finding=%+v err=%v", result, err)
	}
	foundUnlinked := false
	for _, finding := range result {
		foundUnlinked = foundUnlinked || finding.AccountID == "bridge-c"
	}
	if !foundUnlinked {
		t.Fatalf("unlinked bridge account missing: %+v", result)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (CardKind{}).Analyze(ctx, input); err != context.Canceled {
		t.Fatalf("cancellation=%v", err)
	}
}
