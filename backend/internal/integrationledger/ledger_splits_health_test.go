package integrationledger

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Completeness at store level (no builder screen or split HTTP routes
// exist yet — stated, API level is impossible): proposing and accepting
// a split over a ledger row moves no money, proved by a full balance
// snapshot diff, and the yen probe allocates its exact shares. Health
// asserts the documented verdict per check over the ledger: the mix the
// seed honestly yields, with thin-by-construction checks marked.

func ledgerCanonicalModel(t *testing.T, scoped store.Store) string {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestLedgerSplitAcceptMovesNoMoney(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	byName := ledgerPostingIDs(t, world.ownerSC)
	groceries := byName["GROCER 123"]
	if len(groceries) != 4 {
		t.Fatalf("grocery rows = %d, want 4", len(groceries))
	}

	before := ledgerCanonicalModel(t, world.ownerSC)
	// Splits divide shared transactions: the second participant needs
	// current access to the source row first.
	ledgerGrant(t, world, groceries[0], store.SharingAudienceUser, world.second)
	split, err := world.db.CreateSplit(world.owner, store.SplitInput{
		SourceOwnerID:   world.owner,
		SourcePostingID: groceries[0],
		InitiatorID:     world.owner,
		Currency:        "USD",
		TotalMinor:      15000,
		ParticipantIDs:  []string{world.owner, world.second},
	}, ledgerRequestID(t))
	if err != nil {
		t.Fatalf("propose split: %v", err)
	}
	if split.Status != store.SplitStatusProposed || len(split.Allocations) != 2 {
		t.Fatalf("split = %+v, want proposed over 2", split)
	}
	for _, allocation := range split.Allocations {
		if allocation.AmountMinor != 7500 || allocation.Accepted {
			t.Fatalf("allocation = %+v, want unaccepted 7500", allocation)
		}
	}
	accepted, err := world.db.AcceptSplit(world.owner, split.ID, split.Version, ledgerRequestID(t))
	if err != nil {
		t.Fatalf("owner accept: %v", err)
	}
	accepted, err = world.db.AcceptSplit(world.second, split.ID, accepted.Version, ledgerRequestID(t))
	if err != nil {
		t.Fatalf("second accept: %v", err)
	}
	if accepted.Status != store.SplitStatusAccepted {
		t.Fatalf("split status = %q, want accepted after every share accepts", accepted.Status)
	}
	for _, allocation := range accepted.Allocations {
		if !allocation.Accepted {
			t.Fatalf("allocation = %+v, want accepted", allocation)
		}
	}
	// Full balance snapshot diff: proposing and accepting moved no money.
	if after := ledgerCanonicalModel(t, world.ownerSC); after != before {
		t.Fatal("financial model moved under a split accept")
	}
	secondBefore := ledgerCanonicalModel(t, world.secondSC)
	if after := ledgerCanonicalModel(t, world.secondSC); after != secondBefore {
		t.Fatal("recipient model moved under a split accept")
	}
}

func TestLedgerYenSplitAllocatesExactShares(t *testing.T) {
	world := ledgerSetup(t, nil)
	probe := world.pack.SplitProbes()
	if len(probe) != 1 || probe[0].Currency != "JPY" {
		t.Fatalf("split probes = %+v, want the yen probe beside the seed", probe)
	}
	// Posting-level currency is not in the model (amounts are bare
	// expressions): the yen row lives as this split probe, stated here.
	participants := []string{world.owner, world.second, "ledger-guest"}
	shares, err := domain.AllocateSplit(domain.SplitInput{
		TotalMinor: probe[0].TotalMinor, Currency: probe[0].Currency,
		InitiatorID: world.owner, ParticipantIDs: participants,
	})
	if err != nil {
		t.Fatalf("allocate yen: %v", err)
	}
	want := world.expected
	if len(shares) != want.JPYParts {
		t.Fatalf("shares = %d, want %d", len(shares), want.JPYParts)
	}
	var total int64
	for i, share := range shares {
		total += share.AmountMinor
		if share.AmountMinor != want.JPYShares[i] || share.ParticipantID != participants[i] {
			t.Fatalf("shares = %+v, want %v in participant order with the remainder first", shares, want.JPYShares)
		}
	}
	if total != want.JPYTotal {
		t.Fatalf("shares sum = %d, want %d", total, want.JPYTotal)
	}
}

func TestLedgerHealthYieldsDocumentedVerdicts(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)

	posRaw, _ := json.Marshal(map[string]string{"asOfDate": "2026-04-30"})
	posReq := httptest.NewRequest(http.MethodPost, "/v1/position", bytes.NewReader(posRaw))
	posReq.Header.Set("Content-Type", "application/json")
	posResp := httptest.NewRecorder()
	world.plan.ServeHTTP(posResp, posReq)
	var posPayload struct {
		Result *types.CurrentPosition `json:"result"`
	}
	if err := json.Unmarshal(posResp.Body.Bytes(), &posPayload); err != nil || posPayload.Result == nil {
		t.Fatalf("position = %d, want a result", posResp.Code)
	}
	// Documented defaults, stated openly: a 119-day lookback covers the
	// whole seed window in whole calendar months, and the savings
	// guideline sits at half.
	standards := domain.NormalizeFinancialHealthStandards(func() types.FinancialHealthStandards {
		guidelines := types.DefaultFinancialHealthStandards()
		guidelines.LookbackDays = 119
		guidelines.SavingsRateMeet = 0.50
		return guidelines
	}())
	model, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	report := domain.EvaluateFinancialHealth(model, posPayload.Result, standards)
	verdicts := map[string]types.FinancialHealthCheckResult{}
	for _, check := range report.Checks {
		verdicts[string(check.CheckID)] = check
	}
	for check, want := range map[string]types.FinancialHealthStatus{
		"emergency-coverage":       types.FinancialHealthMeeting,
		"cash-flow-sustainability": types.FinancialHealthMeeting,
		"debt-burden":              types.FinancialHealthMeeting,
		"high-interest-debt":       types.FinancialHealthMeeting,
		"savings-rate":             types.FinancialHealthAtRisk,
		"utilization":              types.FinancialHealthInsufficientData,
		"spending-consistency":     types.FinancialHealthMeeting,
	} {
		got, ok := verdicts[check]
		if !ok || got.Status != want {
			t.Fatalf("check %q = %+v, want %q", check, got, want)
		}
	}
	// The at-risk savings rate is genuinely just under half, not a band
	// artifact: the exact decision inputs rate to about 49 cents saved
	// per recorded dollar.
	savings := verdicts["savings-rate"]
	inflow, outflow := savings.Input["windowInflow"], savings.Input["windowOutflow"]
	if inflow != 12046 || outflow != 6093 {
		t.Fatalf("savings input = %+v, want the seed's rounded window flows", savings.Input)
	}
	if rate := (inflow - outflow) / inflow; rate < 0.49 || rate >= 0.50 {
		t.Fatalf("savings rate = %.4f, want just under half", rate)
	}
	if report.FlowCoverage.WindowPostings == 0 || report.FlowCoverage.InflowTotal <= 0 {
		t.Fatalf("coverage = %+v, want the seed's flows behind the verdicts", report.FlowCoverage)
	}
}
