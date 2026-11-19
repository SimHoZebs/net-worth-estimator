package integration

import (
	"encoding/json"
	"fmt"
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
	day := time.Now().UTC().Format("2006-01-02")
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
			model.Checkpoints = nil // Available balances are bank evidence, not owner import rows.
			if _, err := st.ImportModel(model); err != nil {
				t.Fatal(err)
			}
			if _, err := st.ApplySync([]store.SyncCheckpoint{{AccountID: account, Balance: cash + 50, AvailableBalance: &cash, ObservedAt: midnight.Unix() - 1, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}}, nil); err != nil {
				t.Fatal(err)
			}
			if err := st.SetSafeSpendingSettings(types.SafeSpendingSettings{StatementDay: 15, SpendingAccountIDs: []string{account}, TransactionIDs: []string{"same-bill"}}); err != nil {
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
		response := doRowRequest(t, handler, http.MethodGet, "/v1/safe-spending-summary?start="+day+"&end="+day, "")
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
		if got.Revision != revision || got.CashAfterBills == nil || *got.CashAfterBills != want || len(got.Baselines) != 1 || got.Baselines[0].AccountName != subject || len(got.OutstandingObligations) != 1 || got.OutstandingObligations[0].Name != subject+" bill" {
			t.Fatalf("%s summary %+v", subject, got)
		}
		for _, query := range []string{"", "?start=bad&end=" + day, "?start=2026-02-30&end=" + day, "?start=" + day, "?end=" + day, "?start=" + day + "&end=bad", "?start=" + day + "&end=" + midnight.AddDate(0, 0, -1).Format("2006-01-02"), "?start=" + midnight.AddDate(0, 0, 1).Format("2006-01-02") + "&end=" + midnight.AddDate(0, 0, 2).Format("2006-01-02")} {
			res := doRowRequest(t, handler, http.MethodGet, "/v1/safe-spending-summary"+query, "")
			if res.Code != 422 {
				t.Fatalf("invalid query %q: %d %s", query, res.Code, res.Body.String())
			}
		}
		past := midnight.AddDate(0, -1, 0).Format("2006-01-02")
		res := doRowRequest(t, handler, http.MethodGet, fmt.Sprintf("/v1/safe-spending-summary?start=%s&end=%s", past, past), "")
		if res.Code != 200 {
			t.Fatalf("historical %d %s", res.Code, res.Body.String())
		}
		if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.Start != past || got.End != past || got.CashAfterBills != nil || got.CheckingAvailable != nil {
			t.Fatalf("historical %+v", got)
		}
		res = doRowRequest(t, handler, http.MethodGet, "/v1/safe-spending-summary?start="+day+"&end="+midnight.AddDate(0, 1, 0).Format("2006-01-02"), "")
		if res.Code != 200 {
			t.Fatalf("future end %d %s", res.Code, res.Body.String())
		}
	}
}
