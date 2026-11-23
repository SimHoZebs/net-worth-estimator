package integrationedge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// grantTriple names one grant row by its natural key: owner, transaction,
// audience. Grants carry no synthetic ID.
func grantTriple(grant map[string]any) string {
	owner, _ := grant["ownerUserId"].(string)
	transaction, _ := grant["transactionId"].(string)
	audience, _ := grant["audienceId"].(string)
	return owner + "/" + transaction + "/" + audience
}

// Double-spend via retry storms on every mutating share path. Retries with
// one key must replay one outcome; one key reused across actions must fail;
// concurrent storms must record exactly one row per key. Real SQLite store and real production routers over real HTTP; the only stand-in is identity (no OIDC round trip).
// The storm loops three times: green means hostile, not lucky.
func TestIntegrationEdgeGrantRetryStorm_RealSQLite_RealHTTP(t *testing.T) {
	for round := 0; round < 3; round++ {
		world := advSetup(t)
		if world.groupID == "" {
			t.Skip("needs the group identity set")
		}
		day := int64(1781524800)
		shareRow := advMustTransaction(t, world.ownerSC, "Storm row", "50.00", day)
		key := advRequestID(t)
		grantBody := `{"transactionId":` + advQuote(shareRow) + `,"audienceType":"group","audienceId":` + advQuote(world.groupID) + `,"requestId":` + advQuote(key) + `}`
		first := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.ownerSubject, grantBody), http.StatusCreated)
		firstGrant, _ := first["grant"].(map[string]any)
		firstKey := grantTriple(firstGrant)
		if firstKey == "//" {
			t.Fatalf("round %d grant = %+v, want owner/transaction/audience identity", round, first)
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
		// One key reused for a different transaction must fail, never grant.
		otherRow := advMustTransaction(t, world.ownerSC, "Other row", "5.00", day)
		reuse := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.ownerSubject,
			`{"transactionId":`+advQuote(otherRow)+`,"audienceType":"group","audienceId":`+advQuote(world.groupID)+`,"requestId":`+advQuote(key)+`}`)
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
		copyRow := advMustTransaction(t, world.ownerSC, "Copy storm row", "20.00", day)
		if _, err := world.db.GrantSharedTransaction(world.owner, copyRow, "group", world.groupID, advRequestID(t)); err != nil {
			t.Fatal(err)
		}
		key := advRequestID(t)
		copyBody := `{"owner":` + advQuote(advResource(world.owner)) + `,"transactionId":` + advQuote(copyRow) + `,"requestId":` + advQuote(key) + `}`
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
			transaction, _ := decoded["transaction"].(map[string]any)
			id, _ := transaction["id"].(string)
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
		for _, transaction := range model.Transactions {
			if transaction.Name == "Copy storm row" {
				copies++
			}
		}
		if copies != 1 {
			t.Fatalf("round %d recipient rows = %d, want exactly one copy", round, copies)
		}
	}
}
