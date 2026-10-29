package sqlite

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestSyncCredentialDefaultsEmpty(t *testing.T) {
	database := openTestStore(t)
	credential, err := database.GetSyncCredential()
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if credential.Configured() || credential.AccessURL != "" || credential.BridgeHost != "" || credential.UpdatedAt != "" {
		t.Fatalf("default credential = %+v, want empty", credential)
	}
	if cards, err := database.GetSyncCards(); err != nil || len(cards) != 0 {
		t.Fatalf("default cards = %+v, err %v", cards, err)
	}
}

func TestSyncCredentialRoundTrip(t *testing.T) {
	database := openTestStore(t)
	stored, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example")
	if err != nil {
		t.Fatalf("set credential: %v", err)
	}
	if !stored.Configured() {
		t.Fatalf("stored = %+v, want configured", stored)
	}
	loaded, err := database.GetSyncCredential()
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if loaded.AccessURL != "https://user:pass@bridge.example/simplefin" || loaded.BridgeHost != "bridge.example" || loaded.UpdatedAt == "" {
		t.Fatalf("loaded = %+v", loaded)
	}
}

func TestSyncCredentialRotationPreservesCards(t *testing.T) {
	database := openTestStore(t)
	if _, err := database.SetSyncCards([]string{"prime_card"}); err != nil {
		t.Fatalf("set cards: %v", err)
	}
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	rotated, err := database.SetSyncCredential("https://other:secret@bridge.example/simplefin", "bridge.example")
	if err != nil {
		t.Fatalf("rotate credential: %v", err)
	}
	if rotated.AccessURL != "https://other:secret@bridge.example/simplefin" {
		t.Fatalf("rotated access URL = %q", rotated.AccessURL)
	}
	cards, err := database.GetSyncCards()
	if err != nil || len(cards) != 1 || cards[0] != "prime_card" {
		t.Fatalf("cards after rotation = %+v, err %v", cards, err)
	}
}

func TestSyncCredentialEmptySetDisconnects(t *testing.T) {
	database := openTestStore(t)
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	if _, err := database.SetSyncCredential("  ", "bridge.example"); err != nil {
		t.Fatalf("empty set: %v", err)
	}
	credential, err := database.GetSyncCredential()
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if credential.Configured() || credential.AccessURL != "" || credential.BridgeHost != "" || credential.UpdatedAt != "" {
		t.Fatalf("after empty set = %+v, want fully cleared", credential)
	}
}

func TestSyncCredentialClearKeepsCards(t *testing.T) {
	database := openTestStore(t)
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	if _, err := database.SetSyncCards([]string{"prime_card"}); err != nil {
		t.Fatalf("set cards: %v", err)
	}
	if err := database.ClearSyncCredential(); err != nil {
		t.Fatalf("clear credential: %v", err)
	}
	credential, err := database.GetSyncCredential()
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if credential.Configured() || credential.AccessURL != "" || credential.BridgeHost != "" || credential.UpdatedAt != "" {
		t.Fatalf("cleared = %+v, want empty secret fields", credential)
	}
	cards, err := database.GetSyncCards()
	if err != nil || len(cards) != 1 || cards[0] != "prime_card" {
		t.Fatalf("cards after clear = %+v, err %v, want [prime_card]", cards, err)
	}
}

func TestSyncCardsPreserveCredential(t *testing.T) {
	database := openTestStore(t)
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	if _, err := database.SetSyncCards([]string{"checking"}); err != nil {
		t.Fatalf("set cards: %v", err)
	}
	credential, err := database.GetSyncCredential()
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if !credential.Configured() || len(credential.CardAccounts) != 1 || credential.CardAccounts[0] != "checking" {
		t.Fatalf("credential after card edit = %+v", credential)
	}
}

func TestSyncCardsRoundTrip(t *testing.T) {
	database := openTestStore(t)
	stored, err := database.SetSyncCards([]string{"prime_card", "checking"})
	if err != nil {
		t.Fatalf("set cards: %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("stored = %+v", stored)
	}
	loaded, err := database.GetSyncCards()
	if err != nil {
		t.Fatalf("get cards: %v", err)
	}
	if len(loaded) != 2 || loaded[0] != "prime_card" || loaded[1] != "checking" {
		t.Fatalf("loaded = %+v", loaded)
	}
}

func TestClearResetsSyncCredential(t *testing.T) {
	database := openTestStore(t)
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	if _, err := database.SetSyncCards([]string{"prime_card"}); err != nil {
		t.Fatalf("set cards: %v", err)
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	credential, err := database.GetSyncCredential()
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if credential.Configured() {
		t.Fatalf("credential after Clear = %+v, want empty", credential)
	}
}

// TestSyncCredentialSecretNeverSerializes guards the Store contract that the
// AccessURL must never leave the server in API payloads.
func TestSyncCredentialSecretNeverSerializes(t *testing.T) {
	credential := SyncCredential{AccessURL: "https://user:pass@bridge.example/simplefin", BridgeHost: "bridge.example"}
	payload, err := json.Marshal(credential)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, present := decoded["AccessURL"]; present {
		t.Fatalf("serialized credential leaks secret: %s", payload)
	}
}

func TestSyncCredentialIsolatedBetweenPlans(t *testing.T) {
	database, err := SetupDatabase(filepath.Join(t.TempDir(), "isolated.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	planA, err := database.EnsureUser("user-a", "https://issuer.invalid", "alice")
	if err != nil {
		t.Fatal(err)
	}
	planB, err := database.EnsureUser("user-b", "https://issuer.invalid", "bob")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := planA.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := planA.SetSyncCards([]string{"prime_card"}); err != nil {
		t.Fatal(err)
	}
	if other, err := planB.GetSyncCredential(); err != nil || other.Configured() {
		t.Fatalf("plan B credential = %+v, err %v, want empty", other, err)
	}
	if err := planB.Clear(); err != nil {
		t.Fatal(err)
	}
	if kept, err := planA.GetSyncCredential(); err != nil || !kept.Configured() {
		t.Fatalf("plan A credential after B clear = %+v, err %v", kept, err)
	}
	if err := planA.Clear(); err != nil {
		t.Fatal(err)
	}
	if cleared, err := planA.GetSyncCredential(); err != nil || cleared.Configured() {
		t.Fatalf("plan A credential after Clear = %+v, err %v", cleared, err)
	}
	if cards, err := planA.GetSyncCards(); err != nil || len(cards) != 0 {
		t.Fatalf("plan A cards after Clear = %+v, err %v, want forgotten", cards, err)
	}
}
