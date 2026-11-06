package store

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func policyNoon(t *testing.T, day string) int64 {
	t.Helper()
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	return stamp.Add(12 * time.Hour).Unix()
}

func policyFixtureTransaction(source string, destinations []string, txnTime int64) types.Transaction {
	return types.Transaction{
		ID:              "01900000-0000-7000-8000-000000000001",
		Name:            "Policy test",
		SourceAccountID: &source,
		Destinations:    destinations,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      txnTime,
		TransactionTime: txnTime,
		Enabled:         true,
	}
}

func TestNormalizeSharingPolicyInputDefaults(t *testing.T) {
	out, err := NormalizeSharingPolicyInput(SharingPolicyInput{Enabled: false})
	if err != nil {
		t.Fatalf("normalize disabled empty: %v", err)
	}
	if out.StartDate != DefaultSharingStartDate() {
		t.Fatalf("start = %q, want setup-day default %q", out.StartDate, DefaultSharingStartDate())
	}
	if out.EndDate != "" {
		t.Fatalf("end = %q, want open", out.EndDate)
	}
	if len(out.AccountIDs) != 0 {
		t.Fatalf("accounts = %v, want none", out.AccountIDs)
	}
}

func TestNormalizeSharingPolicyInputValidation(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input SharingPolicyInput
	}{
		{"enable without accounts", SharingPolicyInput{Enabled: true, StartDate: "2026-01-01"}},
		{"impossible start", SharingPolicyInput{StartDate: "2026-02-30"}},
		{"malformed start", SharingPolicyInput{StartDate: "not-a-date"}},
		{"malformed end", SharingPolicyInput{StartDate: "2026-01-01", EndDate: "June"}},
		{"end before start", SharingPolicyInput{StartDate: "2026-06-01", EndDate: "2026-05-31"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NormalizeSharingPolicyInput(tc.input); err == nil {
				t.Fatalf("normalize %+v accepted", tc.input)
			}
		})
	}
}

func TestNormalizeSharingPolicyInputCanonicalizes(t *testing.T) {
	out, err := NormalizeSharingPolicyInput(SharingPolicyInput{
		Enabled:    true,
		AccountIDs: []string{" savings ", "checking", "checking", ""},
		StartDate:  "2026-01-01",
		EndDate:    "2026-12-31",
	})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(out.AccountIDs) != 2 || out.AccountIDs[0] != "checking" || out.AccountIDs[1] != "savings" {
		t.Fatalf("accounts = %v, want deduplicated sorted pair", out.AccountIDs)
	}
}

func TestPolicyCoversTransactionMatrix(t *testing.T) {
	policy := SharingPolicy{
		Enabled:    true,
		AccountIDs: []string{"checking", "savings"},
		StartDate:  "2026-01-01",
		EndDate:    "2026-12-31",
	}
	openEnded := SharingPolicy{Enabled: true, AccountIDs: []string{"checking"}, StartDate: "2026-01-01"}
	disabled := SharingPolicy{Enabled: false, AccountIDs: []string{"checking"}, StartDate: "2026-01-01"}
	unselected := SharingPolicy{Enabled: true, StartDate: "2026-01-01"}
	voidRow := policyFixtureTransaction("checking", nil, policyNoon(t, "2026-06-15"))
	voidRow.Void = true
	pendingRow := policyFixtureTransaction("checking", nil, policyNoon(t, "2026-06-15"))
	pendingRow.Pending = true
	for _, tc := range []struct {
		name        string
		policy      SharingPolicy
		transaction types.Transaction
		want        bool
	}{
		{"source match", policy, policyFixtureTransaction("checking", nil, policyNoon(t, "2026-06-15")), true},
		{"destination match", policy, policyFixtureTransaction("other", []string{"savings"}, policyNoon(t, "2026-06-15")), true},
		{"transfer either side", policy, policyFixtureTransaction("checking", []string{"savings"}, policyNoon(t, "2026-06-15")), true},
		{"start edge inclusive", policy, policyFixtureTransaction("checking", nil, policyNoon(t, "2026-01-01")), true},
		{"end edge inclusive", policy, policyFixtureTransaction("checking", nil, policyNoon(t, "2026-12-31")), true},
		{"before start", policy, policyFixtureTransaction("checking", nil, policyNoon(t, "2025-12-31")), false},
		{"after end", policy, policyFixtureTransaction("checking", nil, policyNoon(t, "2027-01-01")), false},
		{"unselected account", policy, policyFixtureTransaction("other", []string{"elsewhere"}, policyNoon(t, "2026-06-15")), false},
		{"policy disabled", disabled, policyFixtureTransaction("checking", nil, policyNoon(t, "2026-06-15")), false},
		{"zero selected accounts", unselected, policyFixtureTransaction("checking", nil, policyNoon(t, "2026-06-15")), false},
		{"void excluded", policy, voidRow, false},
		{"pending like posted", policy, pendingRow, true},
		{"open end", openEnded, policyFixtureTransaction("checking", nil, policyNoon(t, "2027-06-15")), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := PolicyCoversTransaction(tc.policy, tc.transaction); got != tc.want {
				t.Fatalf("eligible = %v, want %v", got, tc.want)
			}
		})
	}
}
