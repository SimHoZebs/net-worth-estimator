package integrationfixtures

import (
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

// Every pack must load, document its concern, seed onto a throwaway
// database, and round-trip its rows without loss. This runs against the
// real store; there are no stand-ins here.
func TestPackEnvelopes(t *testing.T) {
	names, err := Names()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		PackPennyZero, PackCurrencies, PackDuplicates, PackLifecycle,
		PackTimezones, PackUnicode, PackOverlong, PackRecurring,
		PackTransfers, PackBackdated, PackCursors, PackMissingData,
		PackRevocation, PackInvites, PackExclusions, PackLedger,
		PackNegativeNetWorth,
	}
	if len(names) != len(want) {
		t.Fatalf("packs = %v, want %v", names, want)
	}
	seen := map[string]bool{}
	for _, name := range names {
		seen[name] = true
	}
	for _, name := range want {
		if !seen[name] {
			t.Fatalf("packs = %v, missing %q", names, name)
		}
	}
}

func TestPackSeedRoundTrip(t *testing.T) {
	names, err := Names()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "edge.db"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })
			scoped, pack, err := SeedUser(db, "https://issuer.test", "edge-seed", name)
			if err != nil {
				t.Fatal(err)
			}
			model, err := scoped.LoadModel()
			if err != nil {
				t.Fatal(err)
			}
			if len(model.Accounts) != len(pack.Model.Accounts) {
				t.Fatalf("accounts = %d, want %d", len(model.Accounts), len(pack.Model.Accounts))
			}
			if len(model.Postings) != len(pack.Model.Postings) {
				t.Fatalf("postings = %d, want %d", len(model.Postings), len(pack.Model.Postings))
			}
			if len(model.RecurrenceRules) != len(pack.Model.RecurrenceRules) {
				t.Fatalf("rules = %d, want %d", len(model.RecurrenceRules), len(pack.Model.RecurrenceRules))
			}
			byID := map[string]string{}
			for _, posting := range model.Postings {
				byID[posting.ID] = posting.Name
			}
			for _, want := range pack.Model.Postings {
				got, ok := byID[want.ID]
				if !ok {
					t.Fatalf("posting %q missing after seed", want.ID)
				}
				if got != want.Name {
					t.Fatalf("posting %q name = %q, want byte-identical %q", want.ID, got, want.Name)
				}
			}
		})
	}
}
