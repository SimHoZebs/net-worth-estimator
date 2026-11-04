// Command fixtureapi serves the production API over a recorded CSV fixture and
// can restore that baseline on demand. It exists so browser tests exercise the
// real Go engine and the real HTTP surface instead of a client-side stand-in.
//
// This isolated harness intentionally has no identity provider. Its addition is
// POST /__fixture/reset, which clears persisted state, re-imports the fixture,
// and optionally switches the read-only guard. That route belongs to this
// harness and is absent from the production server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/categorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/inbox"
	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	"github.com/simhozebs/net-worth-estimator/backend/internal/obs"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const resetPath = "/__fixture/reset"

// Only this test executable supplies a synthetic, scoped identity without OIDC.
// The fixture user is an ordinary provisioned user: users/<64hex> owned by a
// stable non-empty subject. No kind and no sample special-case travel here.
const (
	fixtureIssuer  = "http://fixture.invalid"
	fixtureSubject = "browser-test"
)

var (
	fixtureActor      = authorization.ActorKey(fixtureIssuer, fixtureSubject)
	fixtureResourceID = "users/" + fixtureActor[len("user:"):]
)

func fixtureHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set(identity.ResourceHeader, fixtureResourceID)
		if r.Method == http.MethodGet && r.URL.Path == "/v1/auth/session" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"enabled": true, "authenticated": true, "allowed": true,
				"user": map[string]string{"subject": fixtureSubject, "name": "Browser test"},
				"resource": map[string]any{"id": fixtureResourceID,
					"permissions": []string{authorization.Read, authorization.Project, authorization.Write}},
			})
			return
		}
		if expected := r.Header.Get(identity.ResourceHeader); expected != "" && expected != fixtureResourceID {
			identity.WriteResourceChanged(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withFixturePrincipal supplies the synthetic fixture identity to the
// social handlers, which read the verified principal from context like the
// production identity middleware provides. Group and sharing routes need no
// other identity service in this harness.
func withFixturePrincipal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := identity.PrincipalContext(r.Context(), identity.Principal{
			Subject:       fixtureSubject,
			Name:          "Browser test",
			Authenticated: true,
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// loadFixtureModel seeds the harness baseline. INTEGRATION_PACK names one
// integration fixture pack (backend/testdata/integration/v1) to seed
// instead of the CSV model, so the browser suite can run its journeys
// against any edge-case dataset on its own isolated ports and throwaway
// database. Empty selects the default CSV fixture.
func loadFixtureModel(modelPath string) (*types.FinancialModel, error) {
	if pack := envOr("INTEGRATION_PACK", ""); pack != "" {
		return integrationfixtures.Model(pack)
	}
	return csvio.ImportModel(modelPath)
}

func main() {
	host := envOr("HOST", "127.0.0.1")
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", filepath.Join(os.TempDir(), "waypoint-fixture.db"))
	modelPath := envOr("NET_WORTH_ESTIMATOR_MODEL_PATH", "public/configs")
	allowedOrigins, err := api.ParseAllowedOrigins(os.Getenv("NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS"))
	if err != nil {
		log.Fatalf("configure allowed origins: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		log.Fatalf("create fixture directory: %v", err)
	}
	application, err := sqlite.SetupDatabase(dbPath)
	if err != nil {
		log.Fatalf("open application database: %v", err)
	}
	defer application.Close()
	stopBlobCleanup := application.StartBlobCleanup(context.Background(), func(err error) { log.Printf("blob cleanup: %v", err) })
	defer stopBlobCleanup()
	database, err := application.EnsureUser(fixtureActor, fixtureIssuer, fixtureSubject)
	if err != nil {
		log.Fatalf("ensure fixture user: %v", err)
	}

	readOnly := parseBool(os.Getenv("NET_WORTH_ESTIMATOR_READ_ONLY"))
	receiptSource, err := receiptmock.New()
	if err != nil {
		log.Fatalf("configure fixture receipt source: %v", err)
	}
	// A reset must not interleave with an in-flight request holding the store.
	var mu sync.Mutex
	live := &switcher{}

	restore := func(nextReadOnly bool, bankTransactions []simplefin.Transaction, bulkOverride *string) error {
		mu.Lock()
		defer mu.Unlock()
		if err := database.Clear(); err != nil {
			return fmt.Errorf("clear store: %w", err)
		}
		// Group tables are global, not per-user, so the plan clear above
		// leaves them behind. This harness has a single user: removing
		// their memberships deletes groups left with no members with
		// their invites and group-scoped consent, restoring the empty
		// baseline between tests.
		if err := application.RemoveGroupMembershipsForUser(fixtureActor); err != nil {
			return fmt.Errorf("clear fixture groups: %w", err)
		}
		// Direct shares name the fixture user as audience on grants owned
		// by seed users, so the user-scoped clear above leaves them behind
		// and they would re-sight as new on the next inbox list. Reset
		// drops them here; group-audience seeds go quiet on their own once
		// the membership above is gone.
		if _, err := application.SQL().Exec(`DELETE FROM sharing_grants WHERE audience_type = 'user' AND audience_id = ?`, fixtureActor); err != nil {
			return fmt.Errorf("clear fixture direct shares: %w", err)
		}
		doc, err := loadFixtureModel(modelPath)
		if err != nil {
			return fmt.Errorf("import fixture: %w", err)
		}
		if _, err := database.ImportModel(doc); err != nil {
			return fmt.Errorf("import fixture: %w", err)
		}
		// Bulk seed is additive on top of the pack or CSV baseline. The
		// reset body may override the INTEGRATION_BULK environment so one
		// spec can request bulk without restarting the harness.
		bulkRaw := os.Getenv("INTEGRATION_BULK")
		if bulkOverride != nil {
			bulkRaw = *bulkOverride
		}
		if strings.TrimSpace(bulkRaw) != "" {
			spec, err := integrationfixtures.ParseBulkSpec(bulkRaw)
			if err != nil {
				return fmt.Errorf("bulk seed: %w", err)
			}
			if _, err := integrationfixtures.InjectBulk(database, spec); err != nil {
				return fmt.Errorf("bulk seed: %w", err)
			}
		}
		if len(bankTransactions) > 0 {
			set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "fixture-bank", Currency: "USD", Balance: "0", Transactions: bankTransactions}}}
			translation, err := simplefin.Translate(set, map[string]string{"fixture-bank": "checking"}, time.Now())
			if err != nil {
				return err
			}
			if _, err := database.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
				return err
			}
		}
		readOnly = nextReadOnly
		apiHandler := api.New(database, api.Config{
			ReceiptSource:  receiptSource,
			AllowedOrigins: allowedOrigins,
			ReadOnly:       readOnly,
			ResourceID:     fixtureResourceID,
		})
		// Social routes ride the same fixture database as the plan API so
		// browser tests exercise real group and sharing behavior. The
		// read-only guard is rebuilt with every restore like the plan API.
		groupRoutes := withFixturePrincipal(groups.New(application, fixtureIssuer, groups.Config{
			AllowedOrigins: allowedOrigins,
			ReadOnly:       readOnly,
		}).Routes())
		sharingRoutes := withFixturePrincipal(sharing.New(application, fixtureIssuer, sharing.Config{
			AllowedOrigins: allowedOrigins,
			ReadOnly:       readOnly,
		}).Routes())
		// Inbox routes ride the same seam: the handler reads the verified
		// principal from context, which the fixture supplies, and the
		// read-only guard is rebuilt with every restore like the plan API.
		inboxRoutes := withFixturePrincipal(inbox.New(application, fixtureIssuer, inbox.Config{
			AllowedOrigins: allowedOrigins,
			ReadOnly:       readOnly,
		}).Routes())
		live.set(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if identity.IsGroupRoute(r.URL.Path) {
				groupRoutes.ServeHTTP(w, r)
				return
			}
			if identity.IsSharingRoute(r.URL.Path) {
				sharingRoutes.ServeHTTP(w, r)
				return
			}
			if identity.IsInboxRoute(r.URL.Path) {
				inboxRoutes.ServeHTTP(w, r)
				return
			}
			apiHandler.ServeHTTP(w, r)
		}))
		return nil
	}

	if err := restore(readOnly, nil, nil); err != nil {
		log.Fatalf("seed fixture: %v", err)
	}
	analysisRunner, err := analysis.NewRunner(application, analysis.Definitions()...)
	if err != nil {
		log.Fatalf("configure analyses: %v", err)
	}
	stopAnalyses := analysisRunner.Start(context.Background(), time.Second, func(error) { log.Print("background analysis temporarily unavailable") })
	defer stopAnalyses()
	categoryWorker, err := categorization.NewWorker(application, categorization.KeywordClassifier{})
	if err != nil {
		log.Fatalf("configure categorization: %v", err)
	}
	stopCategories := categoryWorker.Start(context.Background(), time.Second, func(error) { log.Print("background categorization temporarily unavailable") })
	defer stopCategories()

	mux := http.NewServeMux()
	// Sharing seed provisions a fresh second user, a group with the fixture
	// user as a member, and group-granted postings for shared-feed browser
	// tests. Every call mints a new owner, so seeds never collide with state
	// surviving the user-scoped reset; group names must be distinct per call
	// within a run so the UI lists one matching group.
	mux.Handle("/__fixture/sharing", http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		var body struct {
			GroupName    string               `json:"groupName"`
			OwnerDisplay string               `json:"ownerDisplay"`
			Postings     []fixtureSeedPosting `json:"postings"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			writer.WriteHeader(http.StatusBadRequest)
			fmt.Fprintln(writer, "invalid sharing seed")
			return
		}
		if body.GroupName == "" || body.OwnerDisplay == "" || len(body.Postings) == 0 {
			writer.WriteHeader(http.StatusBadRequest)
			fmt.Fprintln(writer, "groupName, ownerDisplay, and postings are required")
			return
		}
		if err := seedFixtureSharing(application, body.GroupName, body.OwnerDisplay, body.Postings, writer); err != nil {
			writer.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintln(writer, err)
			return
		}
	}))
	// Inbox seed provisions a fresh second user owning the requested
	// postings and grants each one directly to the fixture user, so inbox
	// browser tests exercise real received shares. Every call mints a new
	// owner, so seeds never collide with state surviving the user-scoped
	// reset; named postings revoked here surface on the canceled tab.
	mux.Handle("/__fixture/inbox", http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		var body struct {
			Postings []fixtureSeedPosting `json:"postings"`
			Revoked  []string             `json:"revoked"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			writer.WriteHeader(http.StatusBadRequest)
			fmt.Fprintln(writer, "invalid inbox seed")
			return
		}
		if len(body.Postings) == 0 {
			writer.WriteHeader(http.StatusBadRequest)
			fmt.Fprintln(writer, "postings are required")
			return
		}
		if err := seedFixtureInbox(application, body.Postings, body.Revoked, writer); err != nil {
			writer.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintln(writer, err)
			return
		}
	}))
	mux.Handle(resetPath, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			ReadOnly         *bool                   `json:"readOnly"`
			BankTransactions []simplefin.Transaction `json:"bankTransactions"`
			Bulk             *string                 `json:"bulk"`
			SyncLink         *struct {
				BridgeAccountID string `json:"bridgeAccountId"`
				ModelAccountID  string `json:"modelAccountId"`
				BridgeName      string `json:"bridgeName"`
				Currency        string `json:"currency"`
			} `json:"syncLink"`
		}
		if request.Body != nil {
			// An empty body is valid and keeps the current guard setting.
			_ = json.NewDecoder(request.Body).Decode(&body)
		}
		next := readOnly
		if body.ReadOnly != nil {
			next = *body.ReadOnly
		}
		if err := restore(next, body.BankTransactions, body.Bulk); err != nil {
			writer.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintln(writer, err)
			return
		}
		if body.SyncLink != nil {
			if _, err := database.SaveAccountLink(store.AccountLink{
				BridgeAccountID: body.SyncLink.BridgeAccountID,
				ModelAccountID:  body.SyncLink.ModelAccountID,
				BridgeName:      body.SyncLink.BridgeName,
				Currency:        body.SyncLink.Currency,
				Origin:          store.LinkOriginAuto,
			}); err != nil {
				writer.WriteHeader(http.StatusInternalServerError)
				fmt.Fprintln(writer, err)
				return
			}
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"reset": true,
			"model": modelPath,
		})
	}))
	mux.Handle("/", fixtureHandler(live))

	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", host, port),
		Handler:           obs.Recovery(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE stochastic streams write for the run duration
		IdleTimeout:       120 * time.Second,
	}

	closed := make(chan struct{})
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("graceful shutdown: %v", err)
		}
		close(closed)
	}()

	fmt.Printf("fixtureapi listening on %s from %s\n", server.Addr, modelPath)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server: %v", err)
	}
	<-closed
}

// fixtureSeedPosting describes one seeded shared posting: a display name,
// an amount recipe (a plain number counts as fixed, anything else stays
// calculated), a transaction day, and whether the row is a pending bank
// row.
type fixtureSeedPosting struct {
	Name    string `json:"name"`
	Amount  string `json:"amount"`
	Day     string `json:"day"`
	Pending bool   `json:"pending"`
}

// seedFixtureSharing provisions the shared-feed browser fixture: a second
// user owning an account and the requested postings, a group naming the
// fixture user as a member, and one group grant per posting. Pending rows
// flip through the same lifecycle columns bank sync writes. It answers the
// seed request with the group ID, the owner resource, and the posting IDs.
var fixtureSeedOwners int64

func seedFixtureSharing(application *sqlite.Database, groupName, ownerDisplay string, postings []fixtureSeedPosting, writer http.ResponseWriter) error {
	subject := fmt.Sprintf("sharing-owner-%d", atomic.AddInt64(&fixtureSeedOwners, 1))
	ownerID, err := application.EnsureGroupUser(fixtureIssuer, subject)
	if err != nil {
		return err
	}
	scoped, err := application.EnsureUser(ownerID, fixtureIssuer, subject)
	if err != nil {
		return err
	}
	source := "checking"
	if _, err := scoped.CreateAccount(types.Account{ID: source, Name: "Checking", Enabled: true}); err != nil {
		return err
	}
	group, err := application.CreateGroup(ownerID, groupName, ownerDisplay)
	if err != nil {
		return err
	}
	_, code, err := application.CreateInvite(group.ID, ownerID, 5, time.Hour)
	if err != nil {
		return err
	}
	if _, err := application.AcceptInvite(code, fixtureActor, "Browser test"); err != nil {
		return err
	}
	seeded := []map[string]string{}
	for _, seed := range postings {
		if seed.Name == "" || seed.Amount == "" {
			return fmt.Errorf("seeded postings require a name and an amount")
		}
		day := seed.Day
		if day == "" {
			day = "2026-06-15"
		}
		stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
		if err != nil {
			return fmt.Errorf("seeded day %q is not YYYY-MM-DD", seed.Day)
		}
		posted, err := scoped.CreatePosting(types.Posting{
			Name: seed.Name, SourceAccountID: &source,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": seed.Amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
			Enabled:         true,
		})
		if err != nil {
			return err
		}
		if seed.Pending {
			if _, err := application.SQL().Exec(`UPDATE postings SET pending = 1, source = 'simplefin' WHERE user_id = ? AND id = ?`, ownerID, posted.ID); err != nil {
				return err
			}
		}
		if _, err := application.GrantSharedPosting(ownerID, posted.ID, store.SharingAudienceGroup, group.ID, uuid.NewString()); err != nil {
			return err
		}
		seeded = append(seeded, map[string]string{"id": posted.ID, "name": seed.Name})
	}
	writer.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(writer).Encode(map[string]any{
		"groupId":  group.ID,
		"owner":    "users/" + ownerID[len("user:"):],
		"postings": seeded,
	})
}

// seedFixtureInbox provisions the inbox browser fixture: a second user
// owning an account and the requested postings, with one direct grant per
// posting to the fixture user. Named postings are revoked after a sighting
// pass so they surface on the canceled tab without content; the rest stay
// pending. It answers the seed request with the owner resource and the
// posting IDs.
var fixtureInboxOwners int64

func seedFixtureInbox(application *sqlite.Database, postings []fixtureSeedPosting, revoked []string, writer http.ResponseWriter) error {
	subject := fmt.Sprintf("inbox-owner-%d", atomic.AddInt64(&fixtureInboxOwners, 1))
	ownerID, err := application.EnsureGroupUser(fixtureIssuer, subject)
	if err != nil {
		return err
	}
	scoped, err := application.EnsureUser(ownerID, fixtureIssuer, subject)
	if err != nil {
		return err
	}
	source := "checking"
	if _, err := scoped.CreateAccount(types.Account{ID: source, Name: "Checking", Enabled: true}); err != nil {
		return err
	}
	seeded := []map[string]string{}
	byName := map[string]string{}
	for _, seed := range postings {
		if seed.Name == "" || seed.Amount == "" {
			return fmt.Errorf("seeded postings require a name and an amount")
		}
		if _, dup := byName[seed.Name]; dup {
			return fmt.Errorf("seeded posting %q is not unique", seed.Name)
		}
		day := seed.Day
		if day == "" {
			day = "2026-06-15"
		}
		stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
		if err != nil {
			return fmt.Errorf("seeded day %q is not YYYY-MM-DD", seed.Day)
		}
		posted, err := scoped.CreatePosting(types.Posting{
			Name: seed.Name, SourceAccountID: &source,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": seed.Amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
			Enabled:         true,
		})
		if err != nil {
			return err
		}
		if seed.Pending {
			if _, err := application.SQL().Exec(`UPDATE postings SET pending = 1, source = 'simplefin' WHERE user_id = ? AND id = ?`, ownerID, posted.ID); err != nil {
				return err
			}
		}
		if _, err := application.GrantSharedPosting(ownerID, posted.ID, store.SharingAudienceUser, fixtureActor, uuid.NewString()); err != nil {
			return err
		}
		seeded = append(seeded, map[string]string{"id": posted.ID, "name": seed.Name})
		byName[seed.Name] = posted.ID
	}
	// Canceled shares derive from sightings that lost authorization, so
	// record the grants before revoking: otherwise a share revoked before
	// its first list never surfaces anywhere.
	if _, err := application.ListInboxItems(fixtureActor); err != nil {
		return err
	}
	unshared := []map[string]string{}
	for _, name := range revoked {
		id, ok := byName[name]
		if !ok {
			return fmt.Errorf("revoked posting %q is not a seeded posting", name)
		}
		if err := application.RevokeSharedPosting(ownerID, id, store.SharingAudienceUser, fixtureActor, uuid.NewString()); err != nil {
			return err
		}
		unshared = append(unshared, map[string]string{"id": id, "name": name})
	}
	writer.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(writer).Encode(map[string]any{
		"owner":    "users/" + ownerID[len("user:"):],
		"postings": seeded,
		"revoked":  unshared,
	})
}

type switcher struct {
	mu      sync.RWMutex
	current http.Handler
}

func (s *switcher) set(handler http.Handler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.current = handler
}

func (s *switcher) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	s.mu.RLock()
	handler := s.current
	s.mu.RUnlock()
	if handler == nil {
		writer.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	handler.ServeHTTP(writer, request)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func parseBool(value string) bool {
	switch value {
	case "1", "true", "TRUE", "yes", "YES":
		return true
	default:
		return false
	}
}
