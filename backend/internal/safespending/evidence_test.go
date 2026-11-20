package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestDisabledPendingRemainsEvidenceAndClaimsWithoutMutatingSnapshot(t *testing.T) {
	for _, claimed := range []bool{false, true} {
		for _, at := range []string{"2026-10-31T12:00:00Z", "2026-11-14T12:00:00Z", "2026-11-15T12:00:00Z"} {
			t.Run(at+map[bool]string{false: "unclaimed", true: "claimed"}[claimed], func(t *testing.T) {
				m := baseModel()
				m.Checkpoints[0].Balance = 1844.43
				m.Schedules = []types.Schedule{bill("bill", "2026-11-15", 700)}
				tx := payment("stable-id", 600, at)
				tx.Enabled = false
				tx.Pending = true
				if claimed {
					tx.Claim = &types.TransactionClaim{ScheduleID: "bill", OccurrenceDate: "2026-11-15"}
				}
				m.Transactions = []types.Transaction{tx}
				s := Build(m, nil, "2026-11-15", testEnd)
				// The bank has enough aggregate holds to cover a pre-observation
				// authorization. A later hold cannot borrow that coverage.
				uncertain := at > "2026-11-14T20:00:00Z"
				if len(s.Bills) != 1 || (s.Status == "uncertain") != uncertain {
					t.Fatalf("summary %+v", s)
				}
				if uncertain {
					if s.CheckingAvailable != nil || s.CashAfterBills != nil {
						t.Fatal("post-observation pending coverage presented as exact cash")
					}
				} else {
					assertMoney(t, s.CheckingAvailable, 1244.43)
					if claimed {
						assertMoney(t, s.CashAfterBills, 1144.43)
					} else {
						assertMoney(t, s.CashAfterBills, 544.43)
					}
				}
				if claimed {
					assertMoney(t, s.OutstandingBillsTotal, 100)
				} else {
					assertMoney(t, s.OutstandingBillsTotal, 700)
				}
				if m.Transactions[0].Enabled {
					t.Fatal("mutated simulation eligibility")
				}
				if (s.Bills[0].Status == "pending") != claimed {
					t.Fatalf("claimed occurrence evidence %+v", s.Bills)
				}
				// The bank settles the same identity and its claim remains exact.
				m.Transactions[0].Pending = false
				m.Transactions[0].Enabled = true
				settled := Build(m, nil, "2026-11-15", testEnd)
				if len(settled.Bills) != 1 || (settled.Bills[0].Status == "paid") != claimed {
					t.Fatalf("settlement %+v", settled)
				}
			})
		}
	}
}

func TestOldMultiDestinationFactDoesNotPoisonObservedCash(t *testing.T) {
	m := baseModel()
	tx := payment("old-routing", 100, "2026-11-14T19:00:00Z")
	tx.Destinations = []string{"one", "two"}
	m.Transactions = []types.Transaction{tx}
	s := Build(m, nil, "2026-11-15", testEnd)
	if s.Status != "available" || slices.Contains(s.Reasons, ReasonPostedRoutingUnknown) {
		t.Fatalf("old routing %+v", s)
	}
	assertMoney(t, s.CashAfterBills, 1244.43)
	m.Transactions[0].TransactionTime = stamp("2026-11-14T21:00:00Z")
	s = Build(m, nil, "2026-11-15", testEnd)
	if s.CashAfterBills != nil || !slices.Contains(s.Reasons, ReasonPostedRoutingUnknown) {
		t.Fatalf("new routing %+v", s)
	}
}

func TestCashCutUsesCanonicalTransactionInstantNotPostedMetadata(t *testing.T) {
	m := baseModel()
	m.Checkpoints[0].AvailableBalance = ptr(1608.05)
	before := payment("before", 10, "2026-11-15T10:00:00Z")
	before.TransactionTime = stamp("2026-11-14T19:59:59Z")
	at := payment("at", 20, "2026-11-15T10:00:01Z")
	at.TransactionTime = stamp("2026-11-14T20:00:00Z")
	after := payment("after", 30, "2026-11-14T12:00:00Z")
	after.TransactionTime = stamp("2026-11-14T20:00:01Z")
	fallback := payment("fallback", 40, "2026-11-14T20:00:02Z")
	fallback.TransactionTime = 0
	m.Transactions = []types.Transaction{before, at, after, fallback}
	s := Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.CashAfterBills, 1538.05)
	if len(s.ConfirmedMovements) != 2 || s.ConfirmedMovements[0].TransactionID != "after" || s.ConfirmedMovements[0].EffectiveAt != after.TransactionTime || s.ConfirmedMovements[1].TransactionID != "fallback" {
		t.Fatalf("movements %+v", s.ConfirmedMovements)
	}
}

func TestSameInstantExecutionOrderForKnownRecordedAmountDependencies(t *testing.T) {
	m := baseModel()
	m.Checkpoints[0].AvailableBalance = ptr(1608.05)
	first := payment("first", 10, "2026-11-15T09:00:00Z")
	first.ExecutionOrder = 1
	second := payment("second", 0, "2026-11-15T09:00:00Z")
	second.ExecutionOrder = 2
	second.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "previous * 2"}, Inputs: map[string]types.AmountInputBinding{"previous": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "first"}}}}
	m.Transactions = []types.Transaction{second, first}
	s := Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.CashAfterBills, 1578.05)
	if len(s.ConfirmedMovements) != 2 || s.ConfirmedMovements[0].TransactionID != "first" || s.ConfirmedMovements[1].TransactionID != "second" {
		t.Fatalf("execution order %+v", s)
	}
}

func TestDynamicRecordedAmountsCannotBorrowLaterObservation(t *testing.T) {
	m := baseModel()
	m.Checkpoints[0].AvailableBalance = ptr(1608.05)
	tx := payment("dynamic", 0, "2026-11-15T09:00:00Z")
	tx.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "balance * .1"}, Inputs: map[string]types.AmountInputBinding{"balance": {Source: "provider", Provider: "account-balance", Arguments: map[string]any{"id": "checking"}}}}
	m.Transactions = []types.Transaction{tx}
	s := Build(m, nil, "2026-11-15", testEnd)
	if s.CashAfterBills != nil || s.CheckingAvailable != nil || !slices.Contains(s.Reasons, ReasonPostedAmountUnavailable) {
		t.Fatalf("dynamic amount guessed %+v", s)
	}
	// Once a later actual observation incorporates that transaction, it no
	// longer requires replay to establish cash, but its amount remains unknown.
	m.Checkpoints[0].ObservedAt = stamp("2026-11-15T10:00:00Z")
	s = Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.CashAfterBills, 1608.05)
	if len(s.ConfirmedMovements) != 0 {
		t.Fatal("reconstructed old dynamic actual")
	}
}

func TestRequestedBillSurvivesSimulatedPartialRealizationAndExactClaimReplacesWholeOccurrence(t *testing.T) {
	m := baseModel()
	m.Checkpoints[0].Balance = 100
	m.Checkpoints[0].AvailableBalance = ptr(100.0)
	m.Schedules = []types.Schedule{bill("bill", "2026-11-15", 700)}
	// A simulator can only realize 100, but its claim is not actual evidence.
	projected := payment("simulated-partial", 100, "2026-11-15T09:00:00Z")
	projected.Source = "projected"
	projected.Claim = &types.TransactionClaim{ScheduleID: "bill", OccurrenceDate: "2026-11-15"}
	m.Transactions = []types.Transaction{projected}
	s := Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.OutstandingBillsTotal, 700)
	assertMoney(t, s.CashAfterBills, -600)
	// Canonical claims replace an occurrence, not a guessed unpaid remainder.
	actual := projected
	actual.ID = "confirmed-partial"
	actual.Source = "banksync"
	actual.TransactionTime = stamp("2026-11-14T12:00:00Z")
	actual.PostedTime = actual.TransactionTime
	m.Transactions = append(m.Transactions, actual)
	s = Build(m, nil, "2026-11-15", testEnd)
	assertMoney(t, s.OutstandingBillsTotal, 0)
	assertMoney(t, s.CashAfterBills, 100)
	if len(s.Bills) != 1 || s.Bills[0].Status != "paid" {
		t.Fatalf("invented residual %+v", s)
	}
}

func TestBillWindowOmitsEarlierSchedulesAndSameDayObservationStaysExpected(t *testing.T) {
	for _, due := range []string{"2026-11-01", "2026-11-14", "2026-11-15"} {
		t.Run(due, func(t *testing.T) {
			m := baseModel()
			m.Schedules = []types.Schedule{bill("unclaimed", due, 100)}
			// This actual may have paid the bill, or be unrelated. Matching
			// its amount is not evidence; an exact claim is the only link.
			m.Transactions = []types.Transaction{payment("unclaimed-bank-actual", 100, "2026-11-01T12:00:00Z")}
			s := Build(m, nil, "2026-11-15", testEnd)
			assertMoney(t, s.CheckingAvailable, 1244.43)
			if due <= "2026-11-14" {
				assertMoney(t, s.CashAfterBills, 1244.43)
				assertMoney(t, s.OutstandingBillsTotal, 0)
				if len(s.Bills) != 0 {
					t.Fatalf("out-of-window arrears %+v", s)
				}
			} else {
				assertMoney(t, s.OutstandingBillsTotal, 100)
				assertMoney(t, s.CashAfterBills, 1144.43)
				if s.Bills[0].Status != "unpaid" {
					t.Fatalf("future bill %+v", s)
				}
				// An observation on the bill's own date neither confirms nor
				// denies payment. The bill stays expected, priced and deducted
				// once, so the subtotal and remainder stay available.
				m.Checkpoints[0].ObservedAt = stamp("2026-11-15T08:00:00Z")
				s = Build(m, nil, "2026-11-15", testEnd)
				assertMoney(t, s.CheckingAvailable, 1244.43)
				if s.Status != "available" || len(s.Reasons) != 0 || s.Bills[0].Status != "unpaid" {
					t.Fatalf("same-day observation changed an expected bill %+v", s)
				}
				assertMoney(t, s.OutstandingBillsTotal, 100)
				assertMoney(t, s.CashAfterBills, 1144.43)
			}
			m.Transactions[0].Claim = &types.TransactionClaim{ScheduleID: "unclaimed", OccurrenceDate: due}
			s = Build(m, nil, "2026-11-15", testEnd)
			assertMoney(t, s.CashAfterBills, 1244.43)
			if (due < s.Start && len(s.Bills) != 0) || (due >= s.Start && (len(s.Bills) != 1 || s.Bills[0].Status != "paid")) {
				t.Fatalf("confirmed occurrence ledger %+v", s)
			}
		})
	}
}

func TestInclusiveArbitraryWindowAndCashCutStayIndependent(t *testing.T) {
	m := baseModel()
	m.Schedules = []types.Schedule{bill("before", "2026-11-14", 10), bill("start", "2026-11-15", 20), bill("end", "2026-11-18", 30), bill("after", "2026-11-19", 40)}
	// An observation inside the bill window but after the cash start must
	// never replace the per-account cash evidence selected at start.
	m.Checkpoints = append(m.Checkpoints, types.Checkpoint{AccountID: "checking", Balance: 9999, AvailableBalance: ptr(9999.0), ObservedAt: stamp("2026-11-18T12:00:00Z")})
	m.Transactions = []types.Transaction{payment("future-window-payment", 50, "2026-11-16T12:00:00Z")}
	income := payment("future-window-income", 999, "2026-11-16T12:00:00Z")
	income.SourceAccountID = nil
	income.Destinations = []string{"checking"}
	m.Transactions = append(m.Transactions, income)
	s := Build(m, nil, "2026-11-15", "2026-11-18")
	assertMoney(t, s.CheckingAvailable, 1244.43)
	assertMoney(t, s.OutstandingBillsTotal, 50)
	assertMoney(t, s.CashAfterBills, 1194.43)
	if len(s.ConfirmedMovements) != 0 {
		t.Fatalf("window payments leaked into start cash %+v", s)
	}
	if s.Start != "2026-11-15" || s.End != "2026-11-18" || len(s.Bills) != 2 || s.Bills[0].Date != s.Start || s.Bills[1].Date != s.End {
		t.Fatalf("window %+v", s)
	}
}

func TestExplicitFactualCutExcludesPreauthoredFutureTodayObservationsAndMovements(t *testing.T) {
	m := baseModel()
	m.Checkpoints = append(m.Checkpoints,
		types.Checkpoint{AccountID: "checking", Balance: 200, AvailableBalance: ptr(200.0), ObservedAt: stamp("2026-11-15T09:00:00Z")},
		types.Checkpoint{AccountID: "checking", Balance: 9999, AvailableBalance: ptr(9999.0), ObservedAt: stamp("2026-11-15T13:00:00Z")},
	)
	confirmed := payment("confirmed-income", 20, "2026-11-15T10:00:00Z")
	confirmed.SourceAccountID = nil
	confirmed.Destinations = []string{"checking"}
	future := payment("future-today-income", 500, "2026-11-15T13:00:00Z")
	future.SourceAccountID = nil
	future.Destinations = []string{"checking"}
	m.Transactions = []types.Transaction{confirmed, future, payment("conditional-future-today-bill", 30, "2026-11-15T14:00:00Z")}
	s := buildEvidence(m, nil, "2026-11-15", "2026-11-15", stamp("2026-11-15T12:00:00Z"))
	assertMoney(t, s.CheckingAvailable, 220)
	assertMoney(t, s.OutstandingBillsTotal, 0)
	assertMoney(t, s.CashAfterBills, 220)
	if len(s.Baselines) != 1 || *s.Baselines[0].ObservedAt != stamp("2026-11-15T09:00:00Z") || len(s.ConfirmedMovements) != 1 || s.ConfirmedMovements[0].TransactionID != "confirmed-income" {
		t.Fatalf("future authored fact leaked %+v", s)
	}
}

func TestStaleBillSelectionFallsBackToEligibleRent(t *testing.T) {
	m := baseModel()
	gym := bill("gym", "2026-11-16", 25)
	gym.Enabled = false
	m.Schedules = []types.Schedule{gym, bill("rent", "2026-11-16", 500)}
	s := Build(m, &types.SafeSpendingSettings{TransactionIDs: []string{"gym"}}, "2026-11-15", testEnd)
	if len(s.Bills) != 1 || s.Bills[0].Name != "rent" {
		t.Fatalf("effective selection %+v", s.Bills)
	}
	assertMoney(t, s.OutstandingBillsTotal, 500)
}

func TestPendingClaimCannotBorrowLaterRecordedAmount(t *testing.T) {
	m := baseModel()
	m.Schedules = []types.Schedule{bill("utility", "2026-11-16", 50)}
	hold := payment("hold", 0, "2026-11-14T09:00:00Z")
	hold.Pending = true
	hold.Claim = &types.TransactionClaim{ScheduleID: "utility", OccurrenceDate: "2026-11-16"}
	hold.Amount = types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "previous"}, Inputs: map[string]types.AmountInputBinding{"previous": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "later"}}}}
	m.Transactions = []types.Transaction{hold, payment("later", 80, "2026-11-14T11:00:00Z")}
	s := Build(m, nil, "2026-11-15", testEnd)
	// The hold cannot borrow a price from a later recorded row. Unknown
	// coverage leaves both cash and the uncovered portion unknown.
	if len(s.Bills) != 1 || s.Bills[0].Status != "pending" {
		t.Fatalf("claimed hold evidence %+v", s)
	}
	assertMoney(t, s.Bills[0].Amount, 50)
	if s.OutstandingBillsTotal != nil {
		t.Fatal("unpriced authorization produced a precise cash reservation")
	}
	if s.CheckingAvailable != nil || s.CashAfterBills != nil || !slices.Contains(s.Reasons, ReasonPendingHoldCoverageUnknown) {
		t.Fatalf("unknown hold amount treated as covered: %+v", s)
	}
}

func TestPendingOutsideBillWindowRespectsObservationCut(t *testing.T) {
	for _, claimedOutside := range []bool{false, true} {
		m := baseModel()
		tx := payment("earlier-hold", 363.62, "2026-11-14T12:00:00Z")
		tx.Enabled = false
		tx.Pending = true
		if claimedOutside {
			// Even a transaction dated inside the window is not a bill in it
			// when its exact claim names an earlier occurrence.
			tx.TransactionTime = stamp("2026-11-15T09:00:00Z")
			tx.Claim = &types.TransactionClaim{ScheduleID: "earlier-bill", OccurrenceDate: "2026-11-14"}
		}
		m.Transactions = []types.Transaction{tx}
		s := Build(m, nil, "2026-11-15", testEnd)
		if len(s.Bills) != 0 || len(s.Baselines) != 1 {
			t.Fatalf("outside hold became bill %+v", s)
		}
		assertMoney(t, s.OutstandingBillsTotal, 0)
		assertMoney(t, s.Baselines[0].AvailableBalance, 1244.43)
		if claimedOutside {
			if s.Status != "uncertain" || s.CheckingAvailable != nil || s.CashAfterBills != nil || !slices.Contains(s.Baselines[0].Reasons, ReasonPendingAfterBaselineCoverageUnknown) {
				t.Fatalf("post-observation coverage uncertainty silently dropped %+v", s)
			}
		} else {
			if s.Status != "available" || len(s.Baselines[0].Reasons) != 0 {
				t.Fatalf("old pending row invalidated bank observation %+v", s)
			}
			assertMoney(t, s.CheckingAvailable, 1244.43)
			assertMoney(t, s.CashAfterBills, 1244.43)
		}
	}
}

func TestEarlierOutgoingHoldNeedsBankAvailableToKnowCash(t *testing.T) {
	for _, at := range []string{"2026-11-14T12:00:00Z", "2026-11-14T20:00:00Z"} {
		t.Run(at, func(t *testing.T) {
			m := baseModel()
			m.Checkpoints[0].Source = "banksync"
			hold := payment("earlier-bank-hold", 363.62, at)
			hold.Pending = true
			hold.Enabled = false
			hold.PostedTime = 0
			m.Transactions = []types.Transaction{hold}
			m.Schedules = []types.Schedule{bill("due-one", "2026-11-15", 711.12), bill("due-two", "2026-11-15", 98.92), bill("future", "2026-11-16", 650.97)}
			s := Build(m, nil, "2026-11-15", testEnd)
			if s.Status != "available" || len(s.Reasons) != 0 || len(s.ConfirmedMovements) != 0 || len(s.Bills) != 3 {
				t.Fatalf("observed cash invalidated or old hold deducted twice %+v", s)
			}
			assertMoney(t, s.CheckingAvailable, 1244.43)
			assertMoney(t, s.OutstandingBillsTotal, 1461.01)
			assertMoney(t, s.CashAfterBills, -216.58)

			// A posted-only checkpoint has no available figure to embed the
			// hold, so the replayed posted total stays the numeric cash basis.
			// The pending hold is not a posted movement and is not deducted
			// twice; the dated bills carry the timing check once.
			m.Checkpoints[0].AvailableBalance = nil
			s = Build(m, nil, "2026-11-15", testEnd)
			if s.Status != "available" || len(s.Reasons) != 0 || len(s.Bills) != 3 || len(s.ConfirmedMovements) != 0 {
				t.Fatalf("posted-only checkpoint invalidated the numeric cash basis %+v", s)
			}
			if len(s.Baselines) != 1 || s.Baselines[0].Basis != "posted" || s.Baselines[0].Status != "available" || s.Baselines[0].AvailableBalance != nil || len(s.Baselines[0].Reasons) != 0 {
				t.Fatalf("posted evidence %+v", s.Baselines)
			}
			assertMoney(t, s.Baselines[0].PostedBalance, 1608.05)
			assertMoney(t, s.CheckingAvailable, 1608.05)
			assertMoney(t, s.OutstandingBillsTotal, 1461.01)
			assertMoney(t, s.CashAfterBills, 147.04)
		})
	}
}
