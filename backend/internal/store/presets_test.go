package store

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func testPresetFixture(name string) types.AmountPreset {
	return types.AmountPreset{
		Name: name, Label: "Label " + name, Enabled: true,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "10"},
			Inputs:   map[string]types.AmountInputBinding{},
		},
	}
}

func TestAmountPresetsSeedDefaults(t *testing.T) {
	store := openTestStore(t)
	presets, err := store.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets: %v", err)
	}
	if len(presets) != 8 {
		t.Fatalf("seeded presets = %d, want 8", len(presets))
	}
	names := map[string]bool{}
	for _, preset := range presets {
		if preset.ID == "" || preset.Label == "" {
			t.Fatalf("seed preset missing id/label: %+v", preset)
		}
		if names[preset.Name] {
			t.Fatalf("duplicate seed preset name %s", preset.Name)
		}
		names[preset.Name] = true
	}
	for _, want := range []string{"fixed", "growth", "federal-tax"} {
		if !names[want] {
			t.Fatalf("seed presets missing %s", want)
		}
	}
}

func TestAmountPresetCRUD(t *testing.T) {
	store := openTestStore(t)
	created, err := store.CreateAmountPreset(testPresetFixture("custom"))
	if err != nil {
		t.Fatalf("create preset: %v", err)
	}
	if created.ID == "" {
		t.Fatal("created preset has no id")
	}
	generated, err := store.CreateAmountPreset(types.AmountPreset{
		Label: "Generated", Enabled: true,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "5"},
			Inputs:   map[string]types.AmountInputBinding{},
		},
	})
	if err == nil {
		t.Fatalf("create preset with empty name = %+v, want error", generated)
	}
	if _, err := store.CreateAmountPreset(testPresetFixture("custom")); !IsIDConflict(err) {
		t.Fatalf("duplicate preset err = %v, want id-conflict", err)
	}
	if _, err := store.CreateAmountPreset(types.AmountPreset{ID: "sfin-x", Name: "sync", Label: "Sync"}); !IsReservedID(err) {
		t.Fatalf("reserved preset err = %v, want reserved-id", err)
	}
	created.Label = "Renamed"
	created.Enabled = false
	updated, err := store.UpdateAmountPreset(created)
	if err != nil || updated.Label != "Renamed" || updated.Enabled {
		t.Fatalf("update preset = %+v, err %v", updated, err)
	}
	renamed := updated
	renamed.Name = "other"
	if _, err := store.UpdateAmountPreset(renamed); err == nil {
		t.Fatal("preset rename succeeded, want immutable error")
	}
	if _, err := store.UpdateAmountPreset(testPresetFixture("missing")); !IsNotFound(err) {
		t.Fatalf("update missing err = %v, want not-found", err)
	}
	if err := store.DeleteAmountPreset(created.ID); err != nil {
		t.Fatalf("delete preset: %v", err)
	}
	if err := store.DeleteAmountPreset(created.ID); !IsNotFound(err) {
		t.Fatalf("delete missing err = %v, want not-found", err)
	}
}

func TestAmountPresetMovePreservesOrder(t *testing.T) {
	store := openTestStore(t)
	presets, err := store.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets: %v", err)
	}
	if len(presets) < 2 {
		t.Fatalf("need seeded presets, got %d", len(presets))
	}
	first, second := presets[0].ID, presets[1].ID
	if err := store.MoveAmountPreset(first, ""); err != nil {
		t.Fatalf("move preset to end: %v", err)
	}
	ordered, err := store.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets: %v", err)
	}
	if ordered[len(ordered)-1].ID != first {
		t.Fatalf("last preset = %s, want %s", ordered[len(ordered)-1].ID, first)
	}
	if err := store.MoveAmountPreset(first, second); err != nil {
		t.Fatalf("move preset before: %v", err)
	}
	ordered, err = store.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets: %v", err)
	}
	for i, preset := range ordered {
		if preset.ID == first && (i+1 >= len(ordered) || ordered[i+1].ID != second) {
			t.Fatalf("preset %s not immediately before %s", first, second)
		}
	}
	if err := store.MoveAmountPreset("missing", ""); !IsNotFound(err) {
		t.Fatalf("move missing err = %v, want not-found", err)
	}
}

func TestClearPreservesAmountPresets(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	presets, err := store.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets after clear: %v", err)
	}
	if len(presets) != 8 {
		t.Fatalf("presets after clear = %d, want 8 seeds kept", len(presets))
	}
	if exists, err := store.DocumentExists(); err != nil || exists {
		t.Fatalf("document exists after clear = %v, err %v", exists, err)
	}
}

func TestAmountPresetConformanceRoundTrip(t *testing.T) {
	testAmountPresetConformanceRoundTrip(t, openTestStore)
}

func testAmountPresetConformanceRoundTrip(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	created, err := store.CreateAmountPreset(testPresetFixture("conformance"))
	if err != nil {
		t.Fatalf("create preset: %v", err)
	}
	presets, err := store.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets: %v", err)
	}
	found := false
	for _, preset := range presets {
		if preset.ID == created.ID {
			found = true
			if preset.Label != "Label conformance" {
				t.Fatalf("preset label = %q", preset.Label)
			}
		}
	}
	if !found {
		t.Fatal("created preset missing from list")
	}
	created.Summary = "updated"
	updated, err := store.UpdateAmountPreset(created)
	if err != nil || updated.Summary != "updated" {
		t.Fatalf("update preset = %+v, err %v", updated, err)
	}
	if err := store.MoveAmountPreset(created.ID, ""); err != nil {
		t.Fatalf("move preset: %v", err)
	}
	if err := store.DeleteAmountPreset(created.ID); err != nil {
		t.Fatalf("delete preset: %v", err)
	}
}
