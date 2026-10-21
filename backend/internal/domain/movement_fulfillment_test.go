package domain

import (
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPublicMovementFulfillmentMatchesEvaluation(t *testing.T) {
	cases := []struct {
		name             string
		requested        float64
		realized         float64
		endingBalance    float64
		floor            float64
		capped           bool
		destinationLimit bool
		missingSource    bool
		unfulfilled      float64
		destination      float64
	}{
		{name: "fully funded", requested: 200, realized: 200, endingBalance: 300},
		{name: "partial payment", requested: 200, realized: 100, unfulfilled: 100},
		{name: "protected balance", requested: 200, realized: 100, endingBalance: 400, floor: 400, unfulfilled: 100},
		{name: "annual limit", requested: 200, realized: 100, endingBalance: 900, capped: true, unfulfilled: 100},
		{name: "destination ceiling", requested: 200, realized: 100, endingBalance: 900, destinationLimit: true, destination: 100},
		{name: "missing source", requested: 200, missingSource: true, unfulfilled: 200},
		{name: "below reportable threshold", requested: 100.49, realized: 100},
		{name: "exact reportable threshold", requested: 100.25, realized: 99.75, unfulfilled: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source := "checking"
			posting := types.Posting{ID: "bill", Name: "Bill", SourceAccountID: &source, Enabled: true}
			account := types.Account{ID: source, Name: "Checking", Kind: types.AccountKindCash, MinBalance: &tc.floor, Enabled: true}
			event := types.MovementEvent{
				Date: "2026-02-05", Sequence: 1,
				Origin:          types.MovementOrigin{Type: "posting", PostingID: posting.ID},
				RequestedAmount: tc.requested, RealizedAmount: tc.realized,
				AccountDeltas: []movementAccountDelta{{AccountID: source, Delta: -tc.realized}},
			}
			row := types.ProjectionRow{
				Date:             event.Date,
				AccountSnapshots: []types.AccountSnapshot{{AccountID: source, Balance: tc.endingBalance}},
			}
			document := types.FinancialModelDocument{Accounts: []types.Account{account}}
			if tc.missingSource {
				document.Accounts = nil
				row.AccountSnapshots = nil
			}
			if tc.destinationLimit {
				ceiling := tc.realized
				posting.Destinations = []string{"loan"}
				document.Accounts = append(document.Accounts, types.Account{ID: "loan", Name: "Loan", MaxBalance: &ceiling, Enabled: true})
				row.AccountSnapshots = append(row.AccountSnapshots, types.AccountSnapshot{AccountID: "loan", Balance: ceiling})
				event.AccountDeltas = append(event.AccountDeltas, movementAccountDelta{AccountID: "loan", Delta: tc.realized})
			}
			if tc.capped {
				cap := tc.realized
				document.RecurrenceRules = []types.RecurrenceRule{{
					ID: posting.ID, Name: posting.Name, SourceAccountID: posting.SourceAccountID,
					AnnualCap: &cap, Enabled: true,
				}}
			} else {
				document.Postings = []types.Posting{posting}
			}
			path := &types.ProjectionPath{
				EffectiveDocument: document, Rows: []types.ProjectionRow{row},
				MovementEvents: []types.MovementEvent{event},
			}
			public := publicMovementEvents(path)[0]
			evaluation := EvaluatePostingFulfillment(path, types.PostingFulfillmentConfig{}, true)
			if public.Fulfillment == nil {
				t.Fatal("public event has no fulfillment assessment")
			}
			if public.Fulfillment.UnfulfilledAmount != tc.unfulfilled || public.Fulfillment.DestinationLimitedAmount != tc.destination {
				t.Fatalf("fulfillment = %+v, want unfulfilled %v destination-limited %v", public.Fulfillment, tc.unfulfilled, tc.destination)
			}
			if len(evaluation.Events) != 1 {
				t.Fatalf("evaluation events = %+v", evaluation.Events)
			}
			detail := evaluation.Events[0]
			if public.Fulfillment.UnfulfilledAmount != detail.UnfulfilledAmount || public.Fulfillment.DestinationLimitedAmount != detail.DestinationLimitedAmount {
				t.Fatalf("public fulfillment %+v differs from evaluation %+v", public.Fulfillment, detail)
			}
			if len(public.BindingConstraints) != len(detail.BindingConstraints) {
				t.Fatalf("public constraints %+v differ from evaluation %+v", public.BindingConstraints, detail.BindingConstraints)
			}
			for index := range public.BindingConstraints {
				if !reflect.DeepEqual(public.BindingConstraints[index], detail.BindingConstraints[index]) {
					t.Fatalf("public constraints %+v differ from evaluation %+v", public.BindingConstraints, detail.BindingConstraints)
				}
			}
			if path.MovementEvents[0].Fulfillment != nil {
				t.Fatal("public adaptation mutated the evaluator-facing path")
			}
		})
	}
}

func TestPublicMovementFulfillmentDoesNotDependOnConfiguredEvaluations(t *testing.T) {
	payload := loadGolden(t, "checkpoints.json")
	document := decodeDocument(t, payload["document"])
	settings := decodeSettings(t, payload["settings"])
	floor := 2400.0
	for index := range document.Accounts {
		if document.Accounts[index].ID == "checking" {
			document.Accounts[index].MinBalance = &floor
		}
	}
	var baseline []types.MovementEvent
	for _, mode := range []string{"absent", "disabled", "selected subset", "all postings"} {
		t.Run(mode, func(t *testing.T) {
			settings.Evaluations = types.EmptyEvaluationTables()
			if mode != "absent" {
				config := map[string]any{"postingIds": nil}
				if mode == "selected subset" {
					config["postingIds"] = []any{"salary"}
				}
				settings.Evaluations.PostingFulfillment = []types.FulfillmentEvaluation{{
					InstanceID: "fulfillment", Name: "Fulfillment", Enabled: mode != "disabled", Config: config,
				}}
			}
			result, err := ProjectFinancialModelDocument(document, settings, types.ModelOverrides{}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(result.MovementEvents) == 0 {
				t.Fatal("projection has no movement events")
			}
			foundShortfall := false
			for _, event := range result.MovementEvents {
				if event.Fulfillment == nil {
					t.Fatalf("event has no fulfillment assessment: %+v", event)
				}
				foundShortfall = foundShortfall || event.Fulfillment.UnfulfilledAmount > 0
			}
			if !foundShortfall {
				t.Fatal("expected an always-on shortfall outside the salary-only evaluation")
			}
			if baseline == nil {
				baseline = result.MovementEvents
			} else if !reflect.DeepEqual(result.MovementEvents, baseline) {
				t.Fatal("configured evaluation changed public fulfillment evidence")
			}
			if mode == "selected subset" {
				envelope := result.Evaluations.PostingFulfillment[0]
				deterministic := envelope.Deterministic.(map[string]any)
				if deterministic["unfulfilledAmount"] != float64(0) {
					t.Fatalf("salary-only evaluation = %+v", deterministic)
				}
			}
		})
	}
}
