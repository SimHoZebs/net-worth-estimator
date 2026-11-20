package integration

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSafeSpendingSummaryHTTPAndUserIsolation(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "summary-shared.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	const day = "2024-11-15"
	midnight, _ := time.Parse("2006-01-02", day)
	for i, subject := range []string{"alice", "bob"} {
		t.Run(subject, func(t *testing.T) {
			const issuer = "https://identity.example"
			st, err := db.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject)
			if err != nil {
				t.Fatal(err)
			}
			cash := 1000.0 + float64(i)*100
			account := "same-account"
			model := &types.FinancialModel{Accounts: []types.Account{{ID: account, Name: subject, Kind: "cash", Enabled: true}}, Checkpoints: []types.Checkpoint{{AccountID: account, Balance: cash + 50, AvailableBalance: &cash, ObservedAt: midnight.Unix() - 1}}, Schedules: []types.Schedule{{ID: "same-bill", Name: subject + " bill", SourceAccountID: &account, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "20"}, Inputs: map[string]types.AmountInputBinding{}}, Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, StartDate: day, Enabled: true}}}
			income := model.Schedules[0]
			income.ID = "income"
			income.SourceAccountID = nil
			income.Destinations = []string{account}
			income.StartDate = midnight.AddDate(0, 0, 1).Format("2006-01-02")
			model.Schedules = append(model.Schedules, income)
			model.Checkpoints = nil // Available balances are bank evidence, not owner import rows.
			if _, err := st.ImportModel(model); err != nil {
				t.Fatal(err)
			}
			if _, err := st.ApplySync([]store.SyncCheckpoint{{AccountID: account, Balance: cash + 50, AvailableBalance: &cash, ObservedAt: midnight.Unix() - 1, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}}, nil); err != nil {
				t.Fatal(err)
			}
			if err := st.SetSafeSpendingSettings(types.SafeSpendingSettings{SavingsTarget: float64(25 + i), IncomeScheduleIDs: []string{"income"}, SpendingAccountIDs: []string{account}, TransactionIDs: []string{"same-bill"}}); err != nil {
				t.Fatal(err)
			}
		})
	}
	// Read after both users have seeded the same identities, not before a
	// second tenant exists. This catches accidental unscoped table reads.
	for i, subject := range []string{"alice", "bob"} {
		st, err := db.EnsureUser(authorization.ActorKey("https://identity.example", subject), "https://identity.example", subject)
		if err != nil {
			t.Fatal(err)
		}
		handler := New(st, Config{ReadOnly: true})
		response := doRowRequest(t, handler, http.MethodGet, "/v1/safe-spending-summary?asOf="+day, "")
		if response.Code != 200 {
			t.Fatalf("%s: %d %s", subject, response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("cache policy %v", response.Header())
		}
		var got types.SafeSpendingSummary
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		loaded, err := st.LoadModel()
		if err != nil {
			t.Fatal(err)
		}
		revision, err := store.ModelETag(loaded)
		if err != nil {
			t.Fatal(err)
		}
		want := 980.0 + float64(i)*100
		if got.CashAsOf != day || got.Revision != revision || got.SafeToSpend == nil || *got.SafeToSpend != want || len(got.Baselines) != 1 || got.Baselines[0].AccountName != subject || len(got.Bills) != 1 || got.Bills[0].Name != subject+" bill" || got.Bills[0].Status != "unpaid" {
			t.Fatalf("%s summary %+v", subject, got)
		}
		if got.PaymentRoom == nil || *got.PaymentRoom != want {
			t.Fatalf("%s payment room %+v", subject, got.PaymentRoom)
		}
		// expected pay and the pre-payday bill are both 20, so capacity is cash.
		wantCapacity := 1000.0 + float64(i)*100
		if got.CardPayoffCapacity == nil || *got.CardPayoffCapacity != wantCapacity {
			t.Fatalf("%s card payoff capacity %v want %v", subject, got.CardPayoffCapacity, wantCapacity)
		}
		if got.IncomeFunded == nil || got.SavingsAllowance == nil ||
			*got.IncomeFunded-*got.SavingsAllowance != float64(25+i) {
			t.Fatalf("%s did not use the tenant's savings goal: %+v", subject, got)
		}
		beforeObservation := midnight.Add(-2 * time.Second).Format(time.RFC3339)
		historical := doRowRequest(t, handler, http.MethodGet, "/v1/safe-spending-summary?asOf="+beforeObservation, "")
		var then types.SafeSpendingSummary
		if historical.Code != http.StatusOK {
			t.Fatalf("%s historical summary: %d %s", subject, historical.Code, historical.Body.String())
		}
		if err := json.Unmarshal(historical.Body.Bytes(), &then); err != nil {
			t.Fatal(err)
		}
		if then.CashAsOf != beforeObservation[:10] || then.CheckingAvailable != nil || then.SafeToSpend != nil {
			t.Fatalf("%s historical summary used a later cash observation: %+v", subject, then)
		}
		for _, invalidCut := range []string{"not-a-date", time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")} {
			invalid := doRowRequest(t, handler, http.MethodGet, "/v1/safe-spending-summary?asOf="+invalidCut, "")
			if invalid.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s invalid cut %q: %d %s", subject, invalidCut, invalid.Code, invalid.Body.String())
			}
		}
	}
}
