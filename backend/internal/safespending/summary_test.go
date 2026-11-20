package safespending

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const testEnd = "2026-11-30"

// These fixtures observe cash on the first day unless a test specifies an instant.
func Build(model *types.FinancialModel, settings *types.SafeSpendingSettings, start, end string) testEvidence {
	return buildEvidence(model, settings, start, end, domain.DayCloseUnix(start))
}

type testEvidence struct {
	types.SafeSpendingSummary
	Start, End                            string
	OutstandingBillsTotal, CashAfterBills *float64
}

func buildEvidence(m *types.FinancialModel, c *types.SafeSpendingSettings, start, end string, cut int64) testEvidence {
	if c == nil {
		c = &types.SafeSpendingSettings{}
	}
	if m == nil {
		m = &types.FinancialModel{}
	}
	st := cashEvidence(m, c, cut)
	total := buildObligations(st.s, m, c, st.selected, st.ctx, cut, start, end, nil)
	st.gateStatus()
	out := testEvidence{SafeSpendingSummary: *st.s, Start: start, End: end, OutstandingBillsTotal: total}
	if total != nil && st.s.CheckingAvailable != nil {
		out.CashAfterBills = money(*st.s.CheckingAvailable - *total)
	}
	return out
}
func stamp(day string) int64 { v, _ := time.Parse(time.RFC3339, day); return v.Unix() }
func ptr[T any](v T) *T      { return &v }
func fixed(v float64) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": fmt.Sprint(v)}, Inputs: map[string]types.AmountInputBinding{}}
}
func baseModel() *types.FinancialModel {
	return &types.FinancialModel{Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}}, Checkpoints: []types.Checkpoint{{AccountID: "checking", Balance: 1608.05, AvailableBalance: ptr(1244.43), ObservedAt: stamp("2026-11-14T20:00:00Z")}}}
}
func bill(id, day string, amount float64) types.Schedule {
	return types.Schedule{ID: id, Name: id, SourceAccountID: ptr("checking"), Amount: fixed(amount), Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, StartDate: day, Enabled: true}
}
func payment(id string, amount float64, at string) types.Transaction {
	return types.Transaction{ID: id, Name: id, SourceAccountID: ptr("checking"), Amount: fixed(amount), PostedTime: stamp(at), TransactionTime: stamp(at), Enabled: true, Source: "banksync"}
}
func assertMoney(t *testing.T, v *float64, want float64) {
	t.Helper()
	if v == nil {
		t.Fatalf("money = nil, want %.2f", want)
	}
	if *v != want {
		t.Fatalf("money = %.2f, want %.2f", *v, want)
	}
}

func TestProductionArithmeticUsesCashObservationAndRequestedBills(t *testing.T) {
	m := baseModel()
	m.Accounts = append(m.Accounts, types.Account{ID: "investment", Kind: "investment", Enabled: true})
	m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "investment", Balance: 100000, ObservedAt: stamp("2026-11-15T10:00:00Z")})
	m.Schedules = []types.Schedule{bill("sofi", "2026-11-15", 711.12), bill("utilities", "2026-11-15", 98.92), bill("car", "2026-11-16", 400), bill("insurance", "2026-11-16", 159.89), bill("sallie", "2026-11-19", 91.08)}
	m.Schedules = append(m.Schedules, types.Schedule{ID: "salary", Name: "salary", Destinations: []string{"checking"}, Amount: fixed(7458.34), Recurrence: types.Recurrence{Unit: types.RecurrenceMonth, Interval: 1, MonthlyMode: types.RecurrenceMonthlyByDate}, StartDate: "2026-11-30", Enabled: true})
	s := Build(m, nil, "2026-11-15", testEnd)
	if s.Status != "available" || len(s.Bills) != 5 || len(s.Baselines) != 1 {
		t.Fatalf("summary %+v", s)
	}
	assertMoney(t, s.CheckingAvailable, 1244.43)
	assertMoney(t, s.OutstandingBillsTotal, 1461.01)
	assertMoney(t, s.CashAfterBills, -216.58)
	if *s.Baselines[0].ObservedAt != stamp("2026-11-14T20:00:00Z") {
		t.Fatal("global latest checkpoint selected")
	}
}

func TestExactClaimReplacesOccurrenceForPostedAndRealPending(t *testing.T) {
	for _, pending := range []bool{true, false} {
		t.Run(fmt.Sprint(pending), func(t *testing.T) {
			m := baseModel()
			m.Checkpoints[0].Balance = 1844.43
			m.Schedules = []types.Schedule{bill("bill", "2026-11-15", 700)}
			tx := payment("stable-bank-id", 600, "2026-11-14T12:00:00Z")
			tx.Pending = pending
			tx.Claim = &types.TransactionClaim{ScheduleID: "bill", OccurrenceDate: "2026-11-15"}
			m.Transactions = []types.Transaction{tx, payment("distinct", 10, "2026-11-16T12:00:00Z")}
			s := Build(m, nil, "2026-11-15", testEnd)
			wantStatus := "paid"
			if pending {
				wantStatus = "pending"
			}
			if len(s.Bills) != 1 || s.Bills[0].Status != wantStatus || s.Bills[0].ID != "schedule:bill:2026-11-15" {
				t.Fatalf("claimed occurrence %+v", s.Bills)
			}
			if pending {
				assertMoney(t, s.Bills[0].Amount, 700)
				assertMoney(t, s.OutstandingBillsTotal, 100)
				assertMoney(t, s.CashAfterBills, 1144.43)
			} else {
				assertMoney(t, s.Bills[0].Amount, 600)
				assertMoney(t, s.OutstandingBillsTotal, 0)
				assertMoney(t, s.CashAfterBills, 1244.43)
			}
			if s.Status != "available" {
				t.Fatalf("real pending hold changed the gate %+v", s)
			}
		})
	}
}

func TestPendingAfterBaselineAndSettledHoldAreUncertain(t *testing.T) {
	for _, pending := range []bool{true, false} {
		m := baseModel()
		tx := payment("same-id", 100, "2026-11-15T09:00:00Z")
		tx.Pending = pending
		m.Transactions = []types.Transaction{tx}
		s := Build(m, nil, "2026-11-15", testEnd)
		if s.Status != "uncertain" || s.CashAfterBills != nil {
			t.Fatalf("pending %v %+v", pending, s)
		}
		if s.CheckingAvailable != nil {
			t.Fatalf("uncertain cash presented as exact: %+v", s)
		}
	}
}

func TestExactObservationCutAndConfirmedMovements(t *testing.T) {
	m := baseModel()
	m.Checkpoints[0].AvailableBalance = ptr(1608.05)
	m.Accounts = append(m.Accounts, types.Account{ID: "savings", Kind: "cash", Enabled: true})
	m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "savings", Balance: 200, AvailableBalance: ptr(200.0), ObservedAt: m.Checkpoints[0].ObservedAt})
	before := payment("before", 11, "2026-11-14T19:59:59Z")
	equal := payment("equal", 12, "2026-11-14T20:00:00Z")
	after := payment("after", 13, "2026-11-14T20:00:01Z")
	income := payment("income", 50, "2026-11-15T10:00:00Z")
	income.SourceAccountID = nil
	income.Destinations = []string{"checking"}
	transfer := payment("internal", 100, "2026-11-15T11:00:00Z")
	transfer.Destinations = []string{"savings"}
	m.Transactions = []types.Transaction{before, equal, after, income, transfer}
	s := Build(m, &types.SafeSpendingSettings{SpendingAccountIDs: []string{"checking", "savings"}}, "2026-11-15", testEnd)
	assertMoney(t, s.CheckingAvailable, 1845.05)
	assertMoney(t, s.CashAfterBills, 1845.05)
	if len(s.ConfirmedMovements) != 4 {
		t.Fatalf("movements %+v", s.ConfirmedMovements)
	}
}

func TestCashAtStartNeverUsesFutureBaselineAndDoesNotReconstructEarlierBills(t *testing.T) {
	m := baseModel()
	m.Schedules = []types.Schedule{bill("current-schedule", "2026-10-01", 2629.91)}
	s := Build(m, nil, "2026-10-19", "2026-10-19")
	if s.Status != "missing" || s.CheckingAvailable != nil || s.CashAfterBills != nil || len(s.Bills) != 0 || s.Baselines[0].ObservedAt != nil {
		t.Fatalf("historical %+v", s)
	}
	m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "checking", Balance: 800, AvailableBalance: ptr(800.0), ObservedAt: stamp("2026-10-18T20:00:00Z")})
	m.Transactions = []types.Transaction{payment("october", 10, "2026-10-19T12:00:00Z")}
	s = Build(m, nil, "2026-10-19", "2026-10-19")
	assertMoney(t, s.CheckingAvailable, 790)
	if len(s.ConfirmedMovements) != 1 || len(s.Bills) != 0 {
		t.Fatalf("historical evidence %+v", s)
	}
}

func TestMissingAvailableBalanceFallsBackToPostedBalance(t *testing.T) {
	m := baseModel()
	m.Checkpoints[0].AvailableBalance = nil
	s := Build(m, nil, "2026-11-15", testEnd)
	if s.Status != "available" || s.Baselines[0].Basis != "posted" {
		t.Fatalf("summary %+v", s)
	}
	if slices.Contains(s.Reasons, "available-balance-missing") {
		t.Fatalf("posted fallback wrongly flagged %+v", s)
	}
	assertMoney(t, s.CheckingAvailable, 1608.05)
	assertMoney(t, s.CashAfterBills, 1608.05)
	m.Schedules = []types.Schedule{bill("utility", "2026-11-15", 15)}
	settlement := payment("after", 13, "2026-11-15T10:00:00Z")
	settlement.Claim = &types.TransactionClaim{ScheduleID: "utility", OccurrenceDate: "2026-11-15"}
	m.Transactions = []types.Transaction{settlement}
	s = Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.CheckingAvailable, 1595.05)
	assertMoney(t, s.CashAfterBills, 1595.05)
	assertMoney(t, s.OutstandingBillsTotal, 0)
	if len(s.ConfirmedMovements) != 1 || len(s.Bills) != 1 || s.Bills[0].Status != "paid" {
		t.Fatalf("settlement %+v", s)
	}
	unresolved := baseModel()
	unresolved.Checkpoints[0].AvailableBalance = nil
	dynamic := payment("dynamic", 0, "2026-11-15T09:00:00Z")
	dynamic.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "balance * .1"}, Inputs: map[string]types.AmountInputBinding{"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "checking"}}}}
	unresolved.Transactions = []types.Transaction{dynamic}
	s = Build(unresolved, nil, "2026-11-15", testEnd)
	if s.Status != "uncertain" || s.CheckingAvailable != nil || s.CashAfterBills != nil {
		t.Fatalf("unresolved %+v", s)
	}
	m.Checkpoints = nil
	s = Build(m, nil, "2026-11-15", testEnd)
	if s.Status != "missing" || s.CheckingAvailable != nil || s.CashAfterBills != nil {
		t.Fatalf("missing %+v", s)
	}
}

func TestSelectionVoidsAndProjectedRows(t *testing.T) {
	m := baseModel()
	m.Schedules = []types.Schedule{bill("past-unpaid", "2026-11-01", 100), bill("chosen", "2026-11-15", 20)}
	void := payment("void", 999, "2026-11-15T09:00:00Z")
	void.Void = true
	void.Claim = &types.TransactionClaim{ScheduleID: "chosen", OccurrenceDate: "2026-11-15"}
	projected := void
	projected.ID = "projected"
	projected.Void = false
	projected.Source = "projected"
	m.Transactions = []types.Transaction{void, projected}
	s := Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.OutstandingBillsTotal, 20)
	s = Build(m, &types.SafeSpendingSettings{TransactionIDs: []string{"chosen"}}, "2026-11-15", testEnd)
	assertMoney(t, s.OutstandingBillsTotal, 20)
	s = Build(m, &types.SafeSpendingSettings{TransactionIDs: []string{}}, "2026-11-15", testEnd)
	assertMoney(t, s.OutstandingBillsTotal, 20)
	s = Build(m, &types.SafeSpendingSettings{SpendingAccountIDs: []string{}}, "2026-11-15", testEnd)
	if !slices.Equal(s.SelectedAccountIDs, []string{"checking"}) || s.CheckingAvailable == nil {
		t.Fatalf("empty selection %+v", s)
	}
}

func TestCanonicalProviderAndMissingDependency(t *testing.T) {
	m := baseModel()
	m.Accounts = append(m.Accounts, types.Account{ID: "debt", Kind: "debt", Enabled: true})
	m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "debt", Balance: -2000, ObservedAt: stamp("2026-11-14T20:00:00Z")})
	m.PaymentTerms = []types.PaymentTerms{{AccountID: "debt", MinimumFixed: 25, MinimumPercent: ptr(.02)}}
	b := bill("minimum", "2026-11-16", 0)
	b.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "minimum"}, Inputs: map[string]types.AmountInputBinding{"minimum": {Source: "provider", Provider: "terms-minimum", Arguments: map[string]any{"id": "debt"}}}}
	m.Schedules = []types.Schedule{b}
	s := Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.OutstandingBillsTotal, 40)
	m.Checkpoints = m.Checkpoints[:1]
	s = Build(m, nil, "2026-11-15", testEnd)
	if s.CashAfterBills != nil || s.OutstandingBillsTotal != nil || s.Bills[0].Amount != nil {
		t.Fatalf("missing dependency %+v", s)
	}
}
