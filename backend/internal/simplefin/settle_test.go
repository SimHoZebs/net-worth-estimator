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
	Name   string                 `json:"name"`
	Hold   settleFixturePosting   `json:"hold"`
	Posted []settleFixturePosting `json:"posted"`
	Want   []string               `json:"want"`
}

type settleFixturePosting struct {
	Name        string `json:"name"`
	AmountCents int64  `json:"amountCents"`
	Day         string `json:"day"`
	Direction   string `json:"direction"`
	Account     string `json:"account"`
}

func fixtureBankRow(id string, item settleFixturePosting, void bool) store.BankRow {
	account := item.Account
	if account == "" {
		account = "prime_card"
	}
	day, err := time.Parse("2006-01-02", item.Day)
	if err != nil {
		panic(err)
	}
	amount := strconv.FormatFloat(float64(item.AmountCents)/100, 'f', 2, 64)
	posting := types.Posting{
		ID:     id,
		Name:   item.Name,
		Source: store.SourceBankSync,
		Amount: types.PostingAmountResolution{
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
		posting.Destinations = []string{account}
	} else {
		posting.SourceAccountID = &account
	}
	return store.BankRow{
		Posting: posting,
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
				names = append(names, candidate.Posting.Name)
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
			profile := profileForPosting(types.Posting{Name: test.name})
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

func TestFloorProfileAcceptsAuthAsFloor(t *testing.T) {
	profile := settleProfiles.Profiles["floor"]
	if !profile.allowsAmount(100, 4500) {
		t.Fatal("floor profile rejected a $1 auth posting $45")
	}
	if profile.allowsAmount(5000, 4000) {
		t.Fatal("floor profile accepted a posted amount below the auth tolerance")
	}
}

func TestSettleCandidatesAcceptsLegacyProviderSource(t *testing.T) {
	// Older bank rows carry the provider id as their source. The matcher
	// must treat them like the current banksync source.
	hold := fixtureBankRow("hold", settleFixturePosting{
		Name: "LYFT *TEMP AUTH HOLD", AmountCents: 7494, Day: "2026-10-31",
	}, true)
	hold.Posting.Source = "simplefin"
	posted := fixtureBankRow("posted", settleFixturePosting{
		Name: "LYFT *STANDARD 10-30", AmountCents: 8122, Day: "2026-11-01",
	}, false)
	posted.Posting.Source = "simplefin"
	candidates := SettleCandidates(hold, []store.BankRow{hold, posted})
	if len(candidates) != 1 || candidates[0].Posting.ID != posted.Posting.ID {
		t.Fatalf("legacy source candidates = %+v, want the posted Lyft charge", candidates)
	}
}
