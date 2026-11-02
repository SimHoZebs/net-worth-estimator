package integrationedge

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Penny-split remainder theft across currencies. An allocator that rounds
// per-share instead of dividing exactly leaks or invents minor units; the
// attack sweeps totals, participant counts, and precisions and demands the
// shares sum exactly to the total with the whole remainder on the
// initiator. Real allocation plus the real store over real SQLite; the only stand-in is
// identity (no OIDC round trip).
func TestIntegrationEdgeSplitRemainderTheft_RealSQLite(t *testing.T) {
	probes := []integrationfixtures.SplitProbe{}
	if pack, err := integrationfixtures.Load(integrationfixtures.PackCurrencies); err != nil {
		t.Fatal(err)
	} else {
		probes = append(probes, pack.Extras.SplitProbes...)
	}
	currencies := []string{"USD", "JPY", "KWD", "BHD", "EUR"}
	for _, currency := range currencies {
		for _, total := range []int64{0, 1, 2, 3, 7, 100} {
			for _, count := range []int{1, 2, 3, 5} {
				probes = append(probes, integrationfixtures.SplitProbe{Currency: currency, TotalMinor: total, Participants: count})
			}
		}
	}
	// Storm suites loop: remainder theft must fail never, not rarely.
	for round := 0; round < 5; round++ {
		world := advSetup(t)
		// Splits persist only over a real shared source every participant
		// can see, so the store leg uses the world's real users. The
		// domain sweep below uses synthetic seats; the store leg uses the
		// same division over real participants.
		realParticipants := []string{world.owner}
		if world.second != "" {
			realParticipants = append(realParticipants, world.second)
		}
		sourceRow := advMustPosting(t, world.ownerSC, "Split source", "100.00", 1781524800)
		if world.groupID != "" {
			if _, err := world.db.GrantSharedPosting(world.owner, sourceRow, "group", world.groupID, advRequestID(t)); err != nil {
				t.Fatal(err)
			}
		} else if world.second != "" {
			if _, err := world.db.GrantSharedPosting(world.owner, sourceRow, "user", world.second, advRequestID(t)); err != nil {
				t.Fatal(err)
			}
		}
		for _, probe := range probes {
			participants := make([]string, 0, probe.Participants)
			for i := 0; i < probe.Participants; i++ {
				participants = append(participants, world.owner)
				if i > 0 {
					// Distinct synthetic participants keep the allocator
					// honest about per-ID shares without extra users.
					participants[i] = world.owner + "#seat-" + string(rune('a'+i))
				}
			}
			initiator := participants[0]
			shares, err := domain.AllocateSplit(domain.SplitInput{
				TotalMinor: probe.TotalMinor, Currency: probe.Currency,
				InitiatorID: initiator, ParticipantIDs: participants,
			})
			if err != nil {
				t.Fatalf("round %d allocate %v: %v", round, probe, err)
			}
			var sum int64
			base := probe.TotalMinor / int64(len(participants))
			remainder := probe.TotalMinor % int64(len(participants))
			for _, share := range shares {
				sum += share.AmountMinor
				want := base
				if share.ParticipantID == initiator {
					want += remainder
				}
				if share.AmountMinor != want {
					t.Fatalf("round %d %v share %q = %d, want %d (remainder to initiator only)",
						round, probe, share.ParticipantID, share.AmountMinor, want)
				}
			}
			if sum != probe.TotalMinor {
				t.Fatalf("round %d %v shares sum = %d, want exactly %d: theft or invention",
					round, probe, sum, probe.TotalMinor)
			}
			// The same division persisted through the real store must agree.
			split, err := world.db.CreateSplit(world.owner, store.SplitInput{
				SourceOwnerID: world.owner, SourcePostingID: sourceRow,
				InitiatorID: world.owner, Currency: probe.Currency,
				TotalMinor: probe.TotalMinor, ParticipantIDs: realParticipants,
			}, advRequestID(t))
			if err != nil {
				t.Fatalf("round %d persist %v: %v", round, probe, err)
			}
			var stored int64
			for _, allocation := range split.Allocations {
				stored += allocation.AmountMinor
			}
			if stored != probe.TotalMinor {
				t.Fatalf("round %d %v stored sum = %d, want %d", round, probe, stored, probe.TotalMinor)
			}
		}
	}
}

// Override totals that do not sum exactly must be rejected, never stored.
func TestIntegrationEdgeSplitOverrideMismatch_RealSQLite(t *testing.T) {
	world := advSetup(t)
	if advIdentitySet() == advSetSolo {
		t.Skip("needs a second participant")
	}
	participants := []string{world.owner, world.second}
	sourceRow := advMustPosting(t, world.ownerSC, "Override source", "100.00", 1781524800)
	if world.groupID != "" {
		if _, err := world.db.GrantSharedPosting(world.owner, sourceRow, "group", world.groupID, advRequestID(t)); err != nil {
			t.Fatal(err)
		}
	} else if _, err := world.db.GrantSharedPosting(world.owner, sourceRow, "user", world.second, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	_, err := world.db.CreateSplit(world.owner, store.SplitInput{
		SourceOwnerID: world.owner, SourcePostingID: sourceRow,
		InitiatorID: world.owner, Currency: "USD",
		TotalMinor: 100, ParticipantIDs: participants,
		Overrides: map[string]int64{world.owner: 60, world.second: 39},
	}, advRequestID(t))
	if err == nil {
		t.Fatal("override short by one minor unit was stored: silent theft of 1")
	}
	exact, err := world.db.CreateSplit(world.owner, store.SplitInput{
		SourceOwnerID: world.owner, SourcePostingID: sourceRow,
		InitiatorID: world.owner, Currency: "USD",
		TotalMinor: 100, ParticipantIDs: participants,
		Overrides: map[string]int64{world.owner: 60, world.second: 40},
	}, advRequestID(t))
	if err != nil {
		t.Fatalf("exact override rejected: %v", err)
	}
	var sum int64
	for _, allocation := range exact.Allocations {
		sum += allocation.AmountMinor
	}
	if sum != 100 {
		t.Fatalf("exact override stored sum = %d, want 100", sum)
	}
}
