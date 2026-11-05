package integrationledger

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Completeness: the four monthly grocery charges are proposed as a
// monthly pattern with the right amount, while the lookalike rows — same
// amount at other merchants, near-duplicate merchant spellings, pending,
// void, and deleted rows — never join it. Detection runs the real
// detector over the real claimed snapshot; confirmation, preview, and
// new-rule creation run over production HTTP; the rule lands in the forecast.

func TestLedgerRecurringProposesMonthlyCharge(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	want := world.expected

	findings, _ := ledgerDetect(t, world.ownerSC)
	byPosting := map[string]types.AnalysisFinding{}
	for _, finding := range findings {
		if finding.Kind != "recurring" {
			t.Fatalf("finding kind = %q, want recurring", finding.Kind)
		}
		byPosting[finding.PostingID] = finding
	}
	byName := ledgerPostingIDs(t, world.ownerSC)
	groceries := byName["GROCER 123"]
	if len(groceries) != want.DetectCount {
		t.Fatalf("grocery rows = %d, want %d", len(groceries), want.DetectCount)
	}
	for _, id := range groceries {
		finding, ok := byPosting[id]
		if !ok {
			t.Fatalf("grocery row %s has no monthly proposal", id)
		}
		if finding.Product != want.DetectCadence || finding.Provider != want.DetectMerchant {
			t.Fatalf("finding = %+v, want %s %s", finding, want.DetectMerchant, want.DetectCadence)
		}
		if len(finding.Evidence) == 0 {
			t.Fatalf("finding %s carries no evidence", id)
		}
	}
	// Lookalikes never join: same amount elsewhere, near-duplicate
	// spellings, pending, void, and (deleted) phantom rows.
	for _, name := range []string{"FUEL STOP", "GROCERY OUTLET", "CORNER GROCER", "PENDING EATS", "VOIDED MART"} {
		for _, id := range byName[name] {
			if _, ok := byPosting[id]; ok {
				t.Fatalf("lookalike row %q joined the monthly proposal", name)
			}
		}
	}
	if len(findings) != want.DetectCount {
		t.Fatalf("findings = %d, want exactly the %d grocery rows", len(findings), want.DetectCount)
	}

	// Confirm, preview, and create through production HTTP; the rule's
	// monthly amount lands in the stored-model forecast. The confirm
	// quotes the finding's own revision, the same optimistic lock the
	// review screen sends.
	listReq := httptest.NewRequest(http.MethodGet, "/v1/analysis-findings", nil)
	listResp := httptest.NewRecorder()
	world.plan.ServeHTTP(listResp, listReq)
	var listed struct {
		Findings []types.AnalysisFinding `json:"findings"`
	}
	if err := json.Unmarshal(listResp.Body.Bytes(), &listed); err != nil || len(listed.Findings) != want.DetectCount {
		t.Fatalf("listed = %d %+v, want the %d findings", len(listed.Findings), listed, want.DetectCount)
	}
	var listedRevision int64
	for _, item := range listed.Findings {
		if item.ID == findings[0].ID {
			listedRevision = item.FeedbackRevision
		}
	}
	confirmBody, _ := json.Marshal(map[string]any{"requestId": ledgerRequestID(t), "runId": findings[0].RunID, "revision": listedRevision, "action": "confirm"})
	confirmReq := httptest.NewRequest(http.MethodPost, "/v1/analysis-findings/"+findings[0].ID+"/feedback", bytes.NewReader(confirmBody))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmResp := httptest.NewRecorder()
	world.plan.ServeHTTP(confirmResp, confirmReq)
	if confirmResp.Code != http.StatusOK {
		t.Fatalf("confirm = %d %s", confirmResp.Code, confirmResp.Body.String())
	}
	previewReq := httptest.NewRequest(http.MethodGet, "/v1/analysis-findings/"+findings[0].ID+"/pattern-to-new-schedule-preview", nil)
	previewResp := httptest.NewRecorder()
	world.plan.ServeHTTP(previewResp, previewReq)
	var preview struct {
		Preview types.PatternToNewSchedulePreview `json:"preview"`
	}
	if err := json.Unmarshal(previewResp.Body.Bytes(), &preview); err != nil || !preview.Preview.Creatable || preview.Preview.Schedule == nil {
		t.Fatalf("preview = %d %+v, want a creatable rule", previewResp.Code, preview)
	}
	if math.Abs(ledgerParseAmount(preview.Preview.Schedule.Amount)-want.DetectAmount) > 0.001 || preview.Preview.Schedule.Frequency != types.FrequencyMonthly {
		t.Fatalf("preview rule = %+v, want monthly %v from the seed charge", preview.Preview.Schedule, want.DetectAmount)
	}
	createReq := httptest.NewRequest(http.MethodPost, "/v1/analysis-findings/"+findings[0].ID+"/pattern-to-new-schedule", nil)
	createResp := httptest.NewRecorder()
	world.plan.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusOK {
		t.Fatalf("create = %d %s", createResp.Code, createResp.Body.String())
	}
	model, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Schedules) != 1 {
		t.Fatalf("rules = %d, want the single created rule", len(model.Schedules))
	}
}

// ledgerParseAmount reads a fixed seed decimal spelling.
func ledgerParseAmount(raw string) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return math.NaN()
	}
	return value
}
