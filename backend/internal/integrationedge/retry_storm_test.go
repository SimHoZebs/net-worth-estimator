package integrationedge

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// grantTriple names one grant row by its natural key: owner, posting,
// audience. Grants carry no synthetic ID.
func grantTriple(grant map[string]any) string {
	owner, _ := grant["ownerUserId"].(string)
	posting, _ := grant["postingId"].(string)
	audience, _ := grant["audienceId"].(string)
	return owner + "/" + posting + "/" + audience
}

// Double-spend via retry storms on every mutating share, split, and
// settlement path. Retries with one key must replay one outcome; one key
// reused across actions must fail; concurrent storms must record exactly
// one row per key and never double-count a linked payment. Real SQLite store and real production routers over real HTTP; the only stand-in is identity (no OIDC round trip).
// The storm loops three times: green means hostile, not lucky.
func TestIntegrationEdgeGrantRetryStorm_RealSQLite_RealHTTP(t *testing.T) {
	for round := 0; round < 3; round++ {
		world := advSetup(t)
		if world.groupID == "" {
			t.Skip("needs the group identity set")
		}
		day := int64(1781524800)
		shareRow := advMustPosting(t, world.ownerSC, "Storm row", "50.00", day)
		key := advRequestID(t)
		grantBody := `{"postingId":` + advQuote(shareRow) + `,"audienceType":"group","audienceId":` + advQuote(world.groupID) + `,"requestId":` + advQuote(key) + `}`
		first := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.ownerSubject, grantBody), http.StatusCreated)
		firstGrant, _ := first["grant"].(map[string]any)
		firstKey := grantTriple(firstGrant)
		if firstKey == "//" {
			t.Fatalf("round %d grant = %+v, want owner/posting/audience identity", round, first)
		}
		results := advStorm(16, func(i int) any {
			response := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.ownerSubject, grantBody)
			if response.Code != http.StatusCreated {
				return response
			}
			decoded := map[string]any{}
			if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
				return err
			}
			grant, _ := decoded["grant"].(map[string]any)
			return grantTriple(grant)
		})
		for _, result := range results {
			switch outcome := result.(type) {
			case string:
				if outcome != firstKey {
					t.Fatalf("round %d replay granted a second row %q beside %q: double-share", round, outcome, firstKey)
				}
			case *httptest.ResponseRecorder:
				t.Fatalf("round %d replay status = %d, want the recorded grant again: %s", round, outcome.Code, outcome.Body.String())
			default:
				t.Fatalf("round %d unexpected replay outcome %T (%v)", round, result, result)
			}
		}
		// One key reused for a different posting must fail, never grant.
		otherRow := advMustPosting(t, world.ownerSC, "Other row", "5.00", day)
		reuse := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.ownerSubject,
			`{"postingId":`+advQuote(otherRow)+`,"audienceType":"group","audienceId":`+advQuote(world.groupID)+`,"requestId":`+advQuote(key)+`}`)
		if reuse.Code != http.StatusConflict {
			t.Fatalf("round %d key reuse status = %d, want 409 with no grant written", round, reuse.Code)
		}
		grants, err := world.db.ListSharingGrants(world.owner)
		if err != nil {
			t.Fatal(err)
		}
		if len(grants) != 1 {
			t.Fatalf("round %d grants = %d, want exactly the first row", round, len(grants))
		}
	}
}

// Concurrent copy storms on one share: every retry replays the one copy,
// and exactly one recipient row exists afterwards.
func TestIntegrationEdgeCopyRetryStorm_RealSQLite_RealHTTP(t *testing.T) {
	for round := 0; round < 3; round++ {
		world := advSetup(t)
		if world.groupID == "" {
			t.Skip("needs the group identity set")
		}
		day := int64(1781524800)
		copyRow := advMustPosting(t, world.ownerSC, "Copy storm row", "20.00", day)
		if _, err := world.db.GrantSharedPosting(world.owner, copyRow, "group", world.groupID, advRequestID(t)); err != nil {
			t.Fatal(err)
		}
		key := advRequestID(t)
		copyBody := `{"owner":` + advQuote(advResource(world.owner)) + `,"postingId":` + advQuote(copyRow) + `,"requestId":` + advQuote(key) + `}`
		results := advStorm(16, func(i int) any {
			return advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/copies", world.secondSubject, copyBody)
		})
		var copyID string
		for _, result := range results {
			response := result.(*httptest.ResponseRecorder)
			if response.Code != http.StatusCreated {
				t.Fatalf("round %d copy status = %d: %s", round, response.Code, response.Body.String())
			}
			decoded := map[string]any{}
			if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
				t.Fatalf("round %d copy decode: %v", round, err)
			}
			posting, _ := decoded["posting"].(map[string]any)
			id, _ := posting["id"].(string)
			if copyID == "" {
				copyID = id
			} else if id != copyID {
				t.Fatalf("round %d copy storm saved %q beside %q: double-copy", round, id, copyID)
			}
		}
		model, err := world.secondSC.LoadModel()
		if err != nil {
			t.Fatal(err)
		}
		copies := 0
		for _, posting := range model.Postings {
			if posting.Name == "Copy storm row" {
				copies++
			}
		}
		if copies != 1 {
			t.Fatalf("round %d recipient rows = %d, want exactly one copy", round, copies)
		}
	}
}

// Split and settlement retry storms at the store level, where those
// mutations live. Same-key replays return the recorded row; concurrent
// same-key storms record one row; one linked payment backs one settlement.
func TestIntegrationEdgeSplitSettlementRetryStorm_RealSQLite_RealHTTP(t *testing.T) {
	for round := 0; round < 3; round++ {
		world := advSetup(t)
		if advIdentitySet() == advSetSolo {
			t.Skip("needs a second participant")
		}
		participants := []string{world.owner, world.second}
		sourceRow := advMustPosting(t, world.ownerSC, "Storm split source", "100.00", 1781524800)
		if world.groupID != "" {
			if _, err := world.db.GrantSharedPosting(world.owner, sourceRow, "group", world.groupID, advRequestID(t)); err != nil {
				t.Fatal(err)
			}
		} else if _, err := world.db.GrantSharedPosting(world.owner, sourceRow, "user", world.second, advRequestID(t)); err != nil {
			t.Fatal(err)
		}
		newInput := func() store.SplitInput {
			return store.SplitInput{
				SourceOwnerID: world.owner, SourcePostingID: sourceRow,
				InitiatorID: world.owner, Currency: "USD",
				TotalMinor: 100, ParticipantIDs: participants,
			}
		}
		key := advRequestID(t)
		first, err := world.db.CreateSplit(world.owner, newInput(), key)
		if err != nil {
			t.Fatal(err)
		}
		results := advStorm(16, func(i int) any {
			split, err := world.db.CreateSplit(world.owner, newInput(), key)
			if err != nil {
				return err
			}
			return split.ID
		})
		for _, result := range results {
			switch outcome := result.(type) {
			case string:
				if outcome != first.ID {
					t.Fatalf("round %d split replay minted %q beside %q", round, outcome, first.ID)
				}
			case error:
				t.Fatalf("round %d split replay failed: %v", round, outcome)
			}
		}
		splits, err := world.db.ListSplits(world.owner)
		if err != nil {
			t.Fatal(err)
		}
		if len(splits) != 1 {
			t.Fatalf("round %d splits = %d, want exactly one row", round, len(splits))
		}
		// The linked-payment double-spend: one real payment backs one
		// settlement. The second record against the same payment fails.
		day := int64(1781524800)
		payRow := advMustPosting(t, world.ownerSC, "Real payment", "60.00", day)
		payKey := advRequestID(t)
		settlement, err := world.db.RecordSettlement(world.owner, store.SettlementInput{
			SplitID: first.ID, ParticipantID: world.second, AmountMinor: 60,
			LinkedOwnerID: world.owner, LinkedPostingID: payRow,
		}, payKey)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := world.db.RecordSettlement(world.owner, store.SettlementInput{
			SplitID: first.ID, ParticipantID: world.second, AmountMinor: 60,
			LinkedOwnerID: world.owner, LinkedPostingID: payRow,
		}, payKey)
		if err != nil {
			t.Fatalf("round %d settlement replay failed: %v", round, err)
		}
		if replay.ID != settlement.ID {
			t.Fatalf("round %d settlement replay minted %q beside %q", round, replay.ID, settlement.ID)
		}
		_, err = world.db.RecordSettlement(world.owner, store.SettlementInput{
			SplitID: first.ID, ParticipantID: world.second, AmountMinor: 60,
			LinkedOwnerID: world.owner, LinkedPostingID: payRow,
		}, advRequestID(t))
		if err == nil {
			t.Fatalf("round %d same payment settled twice: double-spend recorded", round)
		}
		if !errors.Is(err, store.ErrSettlementConflict) && !errors.Is(err, store.ErrSharingConflict) {
			t.Fatalf("round %d double-settle error = %v, want a conflict", round, err)
		}
		history, err := world.db.ListSettlements(world.owner, first.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(history) != 1 {
			t.Fatalf("round %d settlements = %d, want the single recorded payment", round, len(history))
		}
	}
}
