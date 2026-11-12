package integration

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedAPITransferPair(t *testing.T, scoped store.Store) (outFinding, inFinding types.AnalysisFinding) {
	t.Helper()
	for _, account := range []types.Account{
		{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		{ID: "loan", Name: "Loan", Kind: types.AccountKindCash, Enabled: true},
	} {
		if _, err := scoped.CreateAccount(account); err != nil {
			t.Fatal(err)
		}
	}
	postedOut := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC).Unix()
	postedIn := time.Date(2026, 3, 12, 12, 0, 0, 0, time.UTC).Unix()
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{
		{ID: "bank-checking", ConnID: "test-conn", Currency: "USD", Balance: "1000", BalanceDate: postedOut, Transactions: []simplefin.Transaction{
			{ID: "card-pay", Description: "CHASE CREDIT CARD PAYMENT", Amount: "-500", Posted: postedOut},
		}},
		{ID: "bank-loan", ConnID: "test-conn", Currency: "USD", Balance: "200", BalanceDate: postedIn, Transactions: []simplefin.Transaction{
			{ID: "pay-received", Description: "PAYMENT RECEIVED", Amount: "500", Posted: postedIn},
		}},
	}}
	translation, err := simplefin.Translate(set, map[string]string{
		simplefin.AccountKey("test-conn", "bank-checking"): "checking",
		simplefin.AccountKey("test-conn", "bank-loan"):     "loan",
	}, time.Unix(postedIn, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true, "loan": true})); err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("transfer", "transfer-v2")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v %+v", claimed, err, input)
	}
	byDescription := map[string]string{}
	for _, item := range input.Transactions {
		byDescription[item.Facts.Description] = item.TransactionID
	}
	outID, inID := byDescription["CHASE CREDIT CARD PAYMENT"], byDescription["PAYMENT RECEIVED"]
	if outID == "" || inID == "" {
		t.Fatalf("legs=%+v", input.Transactions)
	}
	detections := []types.AnalysisDetection{
		{TransactionID: outID, Kind: "transfer", Provider: "simplefin", Product: "internal-transfer", Role: "outflow", Strength: "strong",
			Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", Reason: "test pair", TransactionIDs: []string{outID, inID}}}},
		{TransactionID: inID, Kind: "transfer", Provider: "simplefin", Product: "internal-transfer", Role: "inflow", Strength: "strong",
			Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", Reason: "test pair", TransactionIDs: []string{inID, outID}}}},
	}
	if err := scoped.CompleteAnalysis(run, detections, ""); err != nil {
		t.Fatal(err)
	}
	items, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(items) != 2 {
		t.Fatalf("findings=%+v err=%v", items, err)
	}
	for _, item := range items {
		if item.TransactionID == outID {
			outFinding = item
		} else {
			inFinding = item
		}
	}
	return outFinding, inFinding
}

func decodeTransferPair(t *testing.T, body []byte) (types.TransferLink, string) {
	t.Helper()
	var output struct {
		Link     types.TransferLink `json:"link"`
		Revision string             `json:"revision"`
	}
	if err := json.Unmarshal(body, &output); err != nil {
		t.Fatal(err)
	}
	return output.Link, output.Revision
}

func decodeTransferLinks(t *testing.T, body []byte) []types.TransferLink {
	t.Helper()
	var output struct {
		Links []types.TransferLink `json:"links"`
	}
	if err := json.Unmarshal(body, &output); err != nil {
		t.Fatal(err)
	}
	if output.Links == nil {
		t.Fatal("links must be an array")
	}
	return output.Links
}

func TestTransferPairHTTPContract(t *testing.T) {
	scoped := openAPIStore(t)
	outFinding, inFinding := seedAPITransferPair(t, scoped)
	handler := New(scoped, Config{Actor: func(context.Context) string { return "verified-subject" }})
	outID, inID := outFinding.TransactionID, inFinding.TransactionID
	wantA, wantB := outID, inID
	if wantB < wantA {
		wantA, wantB = wantB, wantA
	}

	res := callAPI(t, handler, "GET", "/v1/transfer-links", "")
	if res.Code != 200 || res.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("list=%d %s", res.Code, res.Body.String())
	}
	if links := decodeTransferLinks(t, res.Body.Bytes()); len(links) != 0 {
		t.Fatalf("links=%+v", links)
	}

	pairBody, _ := json.Marshal(map[string]any{"peerTransactionId": inID})
	pairPath := "/v1/analysis-findings/" + outFinding.ID + "/transfer-pair"
	res = callAPI(t, handler, "POST", pairPath, string(pairBody))
	if res.Code != 200 {
		t.Fatalf("pair=%d %s", res.Code, res.Body.String())
	}
	link, revision := decodeTransferPair(t, res.Body.Bytes())
	if link.LegA != wantA || link.LegB != wantB || link.FindingID != outFinding.ID || link.Actor != "verified-subject" || link.CreatedAt <= 0 {
		t.Fatalf("link=%+v", link)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	wantRevision, err := store.ModelETag(model)
	if err != nil || revision != wantRevision {
		t.Fatalf("revision=%q want %q err=%v", revision, wantRevision, err)
	}

	res = callAPI(t, handler, "GET", "/v1/transfer-links", "")
	if links := decodeTransferLinks(t, res.Body.Bytes()); len(links) != 1 || links[0] != link {
		t.Fatalf("links=%+v", links)
	}
	res = callAPI(t, handler, "POST", pairPath, string(pairBody))
	if res.Code != 200 {
		t.Fatalf("retry=%d %s", res.Code, res.Body.String())
	}
	if retryLink, _ := decodeTransferPair(t, res.Body.Bytes()); retryLink != link {
		t.Fatalf("retry changed link: %+v vs %+v", retryLink, link)
	}

	// The confirmed pair renders count-once through the flows endpoint.
	settings := types.ProjectionRuntimeSettings{FallbackProjectionStartDate: "2026-04-01", HorizonYears: 1}
	flowsBody, _ := json.Marshal(projectionRequestBody{
		Settings: settings,
		Range:    &projectionRange{StartDate: "2026-03-01", EndDate: "2026-03-31"},
	})
	graph := decodeFlowGraph(t, flowsRequest(t, handler, flowsBody))
	if len(graph.Edges) != 1 || graph.Edges[0].Kind != types.FlowKindTransfer || graph.Edges[0].From != "checking" || graph.Edges[0].To != "loan" || graph.Edges[0].Amount != 500 {
		t.Fatalf("edges=%+v", graph.Edges)
	}
	if len(graph.Edges[0].Sources) != 2 {
		t.Fatalf("sources=%+v, want both legs", graph.Edges[0].Sources)
	}
	if graph.Totals.Actual.Transfer != 500 || graph.Totals.Actual.Outflow != 0 || graph.Totals.Actual.Inflow != 0 {
		t.Fatalf("totals=%+v", graph.Totals.Actual)
	}
	if !graph.Reconciliation.Reconciled {
		t.Fatalf("reconciliation=%+v", graph.Reconciliation)
	}

	res = callAPI(t, handler, "DELETE", "/v1/transfer-links/by-leg/"+inID, "")
	if res.Code != 200 {
		t.Fatalf("unlink=%d %s", res.Code, res.Body.String())
	}
	if links := decodeTransferLinks(t, callAPI(t, handler, "GET", "/v1/transfer-links", "").Body.Bytes()); len(links) != 0 {
		t.Fatalf("links=%+v", links)
	}
	graph = decodeFlowGraph(t, flowsRequest(t, handler, flowsBody))
	if len(graph.Edges) != 2 {
		t.Fatalf("edges=%+v, want the two legs back", graph.Edges)
	}
	if graph.Totals.Actual.Transfer != 0 || graph.Totals.Actual.Outflow != 500 || graph.Totals.Actual.Inflow != 500 {
		t.Fatalf("totals=%+v", graph.Totals.Actual)
	}

	if res := callAPI(t, handler, "DELETE", "/v1/transfer-links/by-leg/"+inID, ""); res.Code != 404 {
		t.Fatalf("second unlink=%d %s", res.Code, res.Body.String())
	}
	badBody, _ := json.Marshal(map[string]any{"peerTransactionId": "missing"})
	if res := callAPI(t, handler, "POST", pairPath, string(badBody)); res.Code != 422 {
		t.Fatalf("unknown peer=%d %s", res.Code, res.Body.String())
	}
	if res := callAPI(t, handler, "POST", "/v1/analysis-findings/missing/transfer-pair", string(pairBody)); res.Code != 404 {
		t.Fatalf("missing finding=%d %s", res.Code, res.Body.String())
	}
	for _, config := range []Config{{ReadOnly: true}, {CanWrite: func(context.Context) bool { return false }}} {
		if res := callAPI(t, New(scoped, config), "POST", pairPath, string(pairBody)); res.Code != 403 {
			t.Fatalf("guard=%d %s", res.Code, res.Body.String())
		}
		if res := callAPI(t, New(scoped, config), "DELETE", "/v1/transfer-links/by-leg/"+inID, ""); res.Code != 403 {
			t.Fatalf("guard=%d %s", res.Code, res.Body.String())
		}
		if res := callAPI(t, New(scoped, config), "GET", "/v1/transfer-links", ""); res.Code != 200 {
			t.Fatalf("read-only list=%d %s", res.Code, res.Body.String())
		}
	}
}
