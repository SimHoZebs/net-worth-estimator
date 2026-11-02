// Package integrationledger proves completeness: every feature shows the
// shared ledger seed's known rows and sums. The seed lives beside these
// specs as backend/testdata/integration/v1/ledger.json with hand-computed
// expected numbers in its extras; no spec invents rows for these journeys,
// and every assertion compares product output to those known numbers.
//
// Every test crosses real boundaries on throwaway SQLite databases: the
// real store, the real sync reconcile for bank rows, the real detectors,
// and the real production routers over real HTTP through httptest. Named
// stand-ins: identity injects the verified principal through the same
// principal-in-context seam production middleware provides (no provider
// round trip); image extraction uses the local stand-in adapter (no OCR);
// mail arrives through a fake fetcher at the provider boundary (no Google
// OAuth). Mail-to-charge matching has no product surface yet and stays
// uncovered, never faked green.
package integrationledger

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/inbox"
	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const ledgerIssuer = "https://issuer.test"

// ledgerNow freezes the bank clock at the ledger's last day so feed
// application stays deterministic.
const ledgerNow = 1777550400 // 2026-04-30 12:00 UTC

type ledgerWorld struct {
	db      *sqlite.Database
	plan    http.Handler
	groups  *groups.Handler
	sharing *sharing.Handler
	inbox   *inbox.Handler

	ownerSubject  string
	secondSubject string
	owner         string
	second        string
	ownerSC       store.Store
	secondSC      store.Store

	pack     integrationfixtures.Pack
	expected *integrationfixtures.LedgerExpected
}

func ledgerRequestID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func ledgerServe(t *testing.T, handler http.Handler, method, target, subject, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if subject != "" {
		request = request.WithContext(identity.PrincipalContext(request.Context(),
			authcontract.Principal{Subject: subject, Name: subject, Authenticated: true}))
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func ledgerDecode(t *testing.T, response *httptest.ResponseRecorder, want int) map[string]any {
	t.Helper()
	if response.Code != want {
		t.Fatalf("status = %d, want %d: %s", response.Code, want, response.Body.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return decoded
}

func ledgerQuote(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

// ledgerSetup seeds one throwaway database from the ledger pack: the
// model rows import directly, then bank feeds apply through the real sync
// reconcile in pack order.
func ledgerSetup(t *testing.T, gmailService *gmail.Service) *ledgerWorld {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	world := &ledgerWorld{db: db}
	tag, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	world.ownerSubject = "ledger-owner-" + tag.String()
	world.secondSubject = "ledger-second-" + tag.String()
	world.owner, world.ownerSC, world.pack = ledgerSeedUser(t, db, world.ownerSubject)
	if world.pack.Extras.LedgerExpected == nil {
		t.Fatal("ledger pack carries no hand-computed expected numbers")
	}
	world.expected = world.pack.Extras.LedgerExpected
	second, err := db.EnsureGroupUser(ledgerIssuer, world.secondSubject)
	if err != nil {
		t.Fatal(err)
	}
	world.second = second
	secondSC, err := db.EnsureUser(second, ledgerIssuer, world.secondSubject)
	if err != nil {
		t.Fatal(err)
	}
	world.secondSC = secondSC
	if _, err := secondSC.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}

	source, err := receiptmock.New()
	if err != nil {
		t.Fatal(err)
	}
	world.plan = api.New(world.ownerSC, api.Config{ReceiptSource: source, GmailService: gmailService, GmailFrontendBaseURL: "https://app.example"})
	world.groups = groups.New(db, ledgerIssuer, groups.Config{})
	world.sharing = sharing.New(db, ledgerIssuer, sharing.Config{})
	world.inbox = inbox.New(db, ledgerIssuer, inbox.Config{})
	// Apply every bank feed but the last: the pack repeats its final feed
	// so the re-sync spec can prove the repeat adds nothing.
	ledgerApplyFeeds(t, world, 0, len(world.pack.Extras.BankFeeds)-1)
	return world
}

func ledgerSeedUser(t *testing.T, db *sqlite.Database, subject string) (string, store.Store, integrationfixtures.Pack) {
	t.Helper()
	scoped, pack, err := integrationfixtures.SeedUser(db, ledgerIssuer, subject, integrationfixtures.PackLedger)
	if err != nil {
		t.Fatalf("seed ledger: %v", err)
	}
	user, err := db.EnsureGroupUser(ledgerIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return user, scoped, pack
}

// ledgerApplyFeeds runs pack bank feeds [from, to) through the real sync
// path: map the bridge rows, reconcile against stored rows, apply.
func ledgerApplyFeeds(t *testing.T, world *ledgerWorld, from, to int) {
	t.Helper()
	feeds := world.pack.Extras.BankFeeds
	if to > len(feeds) {
		t.Fatalf("bank feeds = %d, want up to %d", len(feeds), to)
	}
	for _, feed := range feeds[from:to] {
		transactions := make([]simplefin.Transaction, 0, len(feed))
		for _, row := range feed {
			txn := simplefin.Transaction{ID: row.ID, Description: row.Description, Amount: row.Amount, Posted: row.Posted}
			if row.Pending {
				pending := true
				txn.Pending = &pending
			}
			if row.TransactedAt != nil {
				txn.TransactedAt = row.TransactedAt
			}
			transactions = append(transactions, txn)
		}
		set := &simplefin.AccountSet{Accounts: []simplefin.Account{{
			ID: "ledger-bank", Currency: "USD", Balance: "10000", Transactions: transactions,
		}}}
		plan, err := simplefin.Map(set, map[string]string{"ledger-bank": "checking"}, time.Unix(ledgerNow, 0))
		if err != nil {
			t.Fatalf("map bank feed: %v", err)
		}
		// Like the production runner, reconcile against the stored bank
		// rows so vanished holds void in place instead of lingering.
		bank, err := world.ownerSC.LoadBankPostings()
		if err != nil {
			t.Fatalf("load bank postings: %v", err)
		}
		if _, err := world.ownerSC.ApplySyncPlan(nil, simplefin.Reconcile(plan.Pending, plan.Settled, bank, map[string]bool{"checking": true})); err != nil {
			t.Fatalf("apply bank feed: %v", err)
		}
	}
}

// ledgerPostingIDs returns stored posting IDs by name.
func ledgerPostingIDs(t *testing.T, scoped store.Store) map[string][]string {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string][]string{}
	for _, posting := range model.Postings {
		byName[posting.Name] = append(byName[posting.Name], posting.ID)
	}
	return byName
}

// ledgerDetect runs the real recurring detector over the real claimed
// snapshot and completes the run, returning the stored findings with the
// snapshot revision confirmations must quote.
func ledgerDetect(t *testing.T, scoped store.Store) ([]types.AnalysisFinding, int64) {
	t.Helper()
	run, input, claimed, err := scoped.ClaimAnalysis("recurring", analysis.RecurringVersion)
	if err != nil || !claimed {
		t.Fatalf("claim recurring: claimed=%v err=%v", claimed, err)
	}
	detections, err := analysis.Recurring{}.Analyze(context.Background(), input)
	if err != nil {
		t.Fatalf("run recurring detector: %v", err)
	}
	if err := scoped.CompleteAnalysis(run, detections, ""); err != nil {
		t.Fatalf("complete recurring: %v", err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	return findings, input.Revision
}

func ledgerPostJSON(t *testing.T, handler http.Handler, path string, body any) map[string]any {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	request := httptest.NewRequest(http.MethodPost, path, reader)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return ledgerDecode(t, response, http.StatusOK)
}
