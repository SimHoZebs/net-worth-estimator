package simplefin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type settleFixture struct {
	Version int                 `json:"version"`
	Cases   []settleFixtureCase `json:"cases"`
}

type settleFixtureCase struct {
	Name   string                     `json:"name"`
	Hold   settleFixtureTransaction   `json:"hold"`
	Posted []settleFixtureTransaction `json:"posted"`
	Want   []string                   `json:"want"`
}

type settleFixtureTransaction struct {
	Name        string `json:"name"`
	AmountCents int64  `json:"amountCents"`
	Day         string `json:"day"`
	Direction   string `json:"direction"`
	Account     string `json:"account"`
}

func fixtureBankRow(id string, item settleFixtureTransaction, void bool) store.BankRow {
	account := item.Account
	if account == "" {
		account = "prime_card"
	}
	day, err := time.Parse("2006-01-02", item.Day)
	if err != nil {
		panic(err)
	}
	amount := strconv.FormatFloat(float64(item.AmountCents)/100, 'f', 2, 64)
	transaction := types.Transaction{
		ID:     id,
		Name:   item.Name,
		Source: store.SourceBankSync,
		Amount: types.TransactionAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": amount},
			Inputs:   map[string]types.AmountInputBinding{},
		},
		PostedTime:      day.Unix(),
		TransactionTime: day.Unix(),
		Enabled:         !void,
		Void:            void,
	}
	if item.Direction == "in" {
		transaction.Destinations = []string{account}
	} else {
		transaction.SourceAccountID = &account
	}
	return store.BankRow{
		Transaction: transaction,
		Keys: []store.BankKey{{
			Provider:      store.ProviderSimpleFIN,
			AccountID:     "bridge-" + account,
			TransactionID: id,
		}},
	}
}

func TestSettleCandidatesConformance(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "settle-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture settleFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Version != 1 {
		t.Fatalf("fixture version = %d, want 1", fixture.Version)
	}
	for _, test := range fixture.Cases {
		t.Run(test.Name, func(t *testing.T) {
			hold := fixtureBankRow("hold", test.Hold, true)
			bank := []store.BankRow{hold}
			for index, item := range test.Posted {
				bank = append(bank, fixtureBankRow("posted-"+strconv.Itoa(index), item, false))
			}
			candidates := SettleCandidates(hold, bank)
			names := make([]string, 0, len(candidates))
			for _, candidate := range candidates {
				names = append(names, candidate.Transaction.Name)
			}
			if len(names) != len(test.Want) {
				t.Fatalf("candidates = %v, want %v", names, test.Want)
			}
			for index := range test.Want {
				if names[index] != test.Want[index] {
					t.Fatalf("candidates = %v, want %v", names, test.Want)
				}
			}
		})
	}
}

func TestSettleProfiles(t *testing.T) {
	tests := []struct {
		name        string
		windowDays  int
		amountMode  string
		capture     string
		autoConvert bool
	}{
		{"LYFT *STANDARD 10-30", 7, "bounded", "one-to-one", true},
		{"SHELL OIL 1234", 3, "floor", "one-to-one", true},
		{"MARRIOTT HOTEL", 21, "bounded", "one-to-many", false},
		{"AMAZON MKTPLACE", 14, "bounded", "one-to-many", false},
		{"Unknown Merchant", 7, "bounded", "one-to-one", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			profile := profileForTransaction(types.Transaction{Name: test.name})
			if profile.WindowDays != test.windowDays ||
				profile.AmountMode != test.amountMode ||
				profile.Capture != test.capture ||
				profile.AutoConvert != test.autoConvert {
				t.Fatalf("profile = %+v, want window %d mode %s capture %s auto %v",
					profile, test.windowDays, test.amountMode, test.capture, test.autoConvert)
			}
		})
	}
}

func TestReconciliationInstantPrefersPositivePostedTime(t *testing.T) {
	tests := []struct {
		name        string
		posted      int64
		transacted  int64
		wantInstant int64
	}{
		{name: "posted first", posted: 1773140400, transacted: 1773129600, wantInstant: 1773140400},
		{name: "zero posted falls back", posted: 0, transacted: 1773129600, wantInstant: 1773129600},
		{name: "negative posted falls back", posted: -1, transacted: 1773129600, wantInstant: 1773129600},
		{name: "both missing", posted: 0, transacted: 0, wantInstant: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := reconciliationInstant(types.Transaction{PostedTime: test.posted, TransactionTime: test.transacted})
			if got != test.wantInstant {
				t.Fatalf("instant = %d, want %d", got, test.wantInstant)
			}
		})
	}
}

func TestSettleCandidateUsesPostedInstantButDisplaysOccurredDate(t *testing.T) {
	hold := reconcileBankRow("hold", "Corner Store", "prime_card", "42.10", false, true, pendingKey("prime_card", "auth"))
	hold.Transaction.TransactionTime = 1785542400 // 2026-08-01
	hold.Transaction.PostedTime = 0
	candidate := reconcileBankRow("posted", "Corner Store", "prime_card", "42.10", false, false, pendingKey("prime_card", "post"))
	candidate.Transaction.TransactionTime = 1782864000 // 2026-07-01
	candidate.Transaction.PostedTime = 1785628800      // 2026-08-02

	candidates := SettleCandidates(hold, []store.BankRow{candidate})
	if len(candidates) != 1 {
		t.Fatalf("candidates = %+v, want posted-instant match", candidates)
	}
	if candidates[0].DayGapDays != 1 {
		t.Fatalf("day gap = %d, want 1 from posted instants", candidates[0].DayGapDays)
	}
	if got := SettleCandidateDate(candidates[0]); got != "2026-07-01" {
		t.Fatalf("display date = %s, want occurred date 2026-07-01", got)
	}
	if !settleMatch(hold.Transaction, candidate.Transaction) {
		t.Fatal("settlement window must compare posted instants")
	}
}

func TestFloorProfileAcceptsAuthAsFloor(t *testing.T) {
	// A tiny fuel authorization posts at a much larger amount and still
	// settles the hold in place. A posted amount below the auth's tolerance
	// must not settle it.
	tests := []struct {
		name        string
		authAmount  string
		posted      string
		wantConvert bool
	}{
		{"auth far below posted", "1.00", "45.00", true},
		{"posted below auth tolerance", "50.00", "40.00", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			bank := []store.BankRow{reconcileBankRow("uuid-pending", "SHELL OIL 1234", "prime_card", test.authAmount, true, false,
				pendingKey("prime_card", "old-auth"))}
			settled := []store.SyncTransaction{reconcileTransaction("SHELL OIL 1234", "prime_card", test.posted, false, 1785715200)}
			directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
			_, converts, _ := directivesByAction(directives)
			if test.wantConvert && converts != 1 {
				t.Fatalf("directives = %+v, want one convert", directives)
			}
			if !test.wantConvert && converts != 0 {
				t.Fatalf("directives = %+v, want no convert", directives)
			}
		})
	}
}
