package integrationedge

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Invite-code attacks: a single-use code raced by many redeemers admits
// exactly one member; a redeemed code cannot admit twice; expired and
// revoked codes fail closed with no membership written. Real SQLite store and real production routers over real HTTP; the only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeInviteAcceptStorm_RealSQLite_RealHTTP(t *testing.T) {
	for round := 0; round < 3; round++ {
		world := advSetup(t)
		if world.groupID == "" {
			t.Skip("needs the group identity set")
		}
		before, err := world.db.ListGroupMembers(world.groupID, world.owner)
		if err != nil {
			t.Fatal(err)
		}
		invite := advDecode(t, advServe(t, world.groups.Routes(), http.MethodPost, "/v1/groups/"+world.groupID+"/invites", world.ownerSubject, `{"maxUses":1}`), http.StatusCreated)
		code, _ := invite["code"].(string)
		if code == "" {
			t.Fatalf("round %d invite = %+v, want a code", round, invite)
		}
		body := `{"code":` + advQuote(code) + `}`
		results := advStorm(8, func(i int) any {
			subject := "adv-racer-" + advRequestID(t)
			return advServe(t, world.groups.Routes(), http.MethodPost, "/v1/invites/accept", subject, body)
		})
		wins := 0
		for _, result := range results {
			if result.(*httptest.ResponseRecorder).Code == http.StatusOK {
				wins++
			}
		}
		if wins != 1 {
			t.Fatalf("round %d single-use code admitted %d racers, want exactly one", round, wins)
		}
		after, err := world.db.ListGroupMembers(world.groupID, world.owner)
		if err != nil {
			t.Fatal(err)
		}
		if len(after) != len(before)+1 {
			t.Fatalf("round %d members = %d, want %d after one winning redeem", round, len(after), len(before)+1)
		}
		// The spent code redeemed twice more admits nobody.
		for i := 0; i < 2; i++ {
			retry := advServe(t, world.groups.Routes(), http.MethodPost, "/v1/invites/accept", "adv-late-"+advRequestID(t), body)
			if retry.Code == http.StatusOK {
				t.Fatalf("round %d spent code redeemed again: over-admit", round)
			}
		}
		final, err := world.db.ListGroupMembers(world.groupID, world.owner)
		if err != nil {
			t.Fatal(err)
		}
		if len(final) != len(after) {
			t.Fatalf("round %d members = %d after spent-code retries, want %d", round, len(final), len(after))
		}
	}
}

// An expired invite and a revoked invite both fail closed with no
// membership written. Expiry is forced through the real row so the accept
// path under test stays production code.
func TestIntegrationEdgeExpiredAndRevokedInvite_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	before, err := world.db.ListGroupMembers(world.groupID, world.owner)
	if err != nil {
		t.Fatal(err)
	}
	invite, code := advCreateInvite(t, world)
	past := int64(1700000000)
	if _, err := world.db.SQL().Exec(`UPDATE group_invites SET expires_at = ? WHERE id = ?`, past, invite); err != nil {
		t.Fatalf("expire invite: %v", err)
	}
	expired := advServe(t, world.groups.Routes(), http.MethodPost, "/v1/invites/accept", "adv-expired-"+advRequestID(t), `{"code":`+advQuote(code)+`}`)
	if expired.Code == http.StatusOK {
		t.Fatalf("expired invite redeemed: %s", expired.Body.String())
	}
	invite2, code2, revokeID := advCreateRevocableInvite(t, world)
	if err := world.db.RevokeInvite(world.groupID, revokeID, world.owner); err != nil {
		t.Fatal(err)
	}
	_ = invite2
	revoked := advServe(t, world.groups.Routes(), http.MethodPost, "/v1/invites/accept", "adv-revoked-"+advRequestID(t), `{"code":`+advQuote(code2)+`}`)
	if revoked.Code == http.StatusOK {
		t.Fatalf("revoked invite redeemed: %s", revoked.Body.String())
	}
	after, err := world.db.ListGroupMembers(world.groupID, world.owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("members = %d after expired/revoked accepts, want %d: silent admission", len(after), len(before))
	}
}

func advCreateInvite(t *testing.T, world *advWorld) (string, string) {
	t.Helper()
	created := advDecode(t, advServe(t, world.groups.Routes(), http.MethodPost, "/v1/groups/"+world.groupID+"/invites", world.ownerSubject, `{"maxUses":5}`), http.StatusCreated)
	invite, _ := created["invite"].(map[string]any)
	id, _ := invite["id"].(string)
	code, _ := created["code"].(string)
	if id == "" || code == "" {
		t.Fatalf("invite = %+v, want an ID and a code", created)
	}
	return id, code
}

func advCreateRevocableInvite(t *testing.T, world *advWorld) (string, string, string) {
	t.Helper()
	id, code := advCreateInvite(t, world)
	return id, code, id
}
