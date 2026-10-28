package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"testing"
)

func createPinnedEvaluation(t *testing.T, store store.Store, name string) string {
	t.Helper()
	created, err := store.CreateEvaluation(EvaluationUpdate{Type: "netWorthThreshold", Name: name, Enabled: true, Config: map[string]any{"target": 100}})
	if err != nil {
		t.Fatalf("create evaluation %s: %v", name, err)
	}
	return created.InstanceID
}

func TestPinnedEvaluationsRoundTrip(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	empty, err := store.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("list empty pins: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("empty pins = %v, want none", empty)
	}

	first := createPinnedEvaluation(t, store, "First")
	second := createPinnedEvaluation(t, store, "Second")

	saved, err := store.SetPinnedEvaluations([]string{second, first})
	if err != nil {
		t.Fatalf("set pins: %v", err)
	}
	if len(saved) != 2 || saved[0] != second || saved[1] != first {
		t.Fatalf("saved pins = %v, want [%s %s]", saved, second, first)
	}
	listed, err := store.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("list pins: %v", err)
	}
	if len(listed) != 2 || listed[0] != second || listed[1] != first {
		t.Fatalf("listed pins = %v, want [%s %s]", listed, second, first)
	}
}

func TestPinnedEvaluationsDedupeAndReplace(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	first := createPinnedEvaluation(t, store, "First")
	second := createPinnedEvaluation(t, store, "Second")

	saved, err := store.SetPinnedEvaluations([]string{first, first, "", second, first})
	if err != nil {
		t.Fatalf("set pins: %v", err)
	}
	if len(saved) != 2 || saved[0] != first || saved[1] != second {
		t.Fatalf("saved pins = %v, want [%s %s]", saved, first, second)
	}
	replaced, err := store.SetPinnedEvaluations([]string{second})
	if err != nil {
		t.Fatalf("replace pins: %v", err)
	}
	if len(replaced) != 1 || replaced[0] != second {
		t.Fatalf("replaced pins = %v, want [%s]", replaced, second)
	}
	cleared, err := store.SetPinnedEvaluations(nil)
	if err != nil {
		t.Fatalf("clear pins: %v", err)
	}
	if len(cleared) != 0 {
		t.Fatalf("cleared pins = %v, want none", cleared)
	}
}

func TestPinnedEvaluationsRejectUnknownID(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	if _, err := store.SetPinnedEvaluations([]string{"missing"}); !IsNotFound(err) {
		t.Fatalf("pin unknown = %v, want not-found", err)
	}
	listed, err := store.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("list pins: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("listed pins = %v, want none", listed)
	}
}

func TestPinnedEvaluationsDropOnEvaluationDelete(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	first := createPinnedEvaluation(t, store, "First")
	second := createPinnedEvaluation(t, store, "Second")
	if _, err := store.SetPinnedEvaluations([]string{first, second}); err != nil {
		t.Fatalf("set pins: %v", err)
	}
	if err := store.DeleteEvaluation(first); err != nil {
		t.Fatalf("delete evaluation: %v", err)
	}
	listed, err := store.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("list pins: %v", err)
	}
	if len(listed) != 1 || listed[0] != second {
		t.Fatalf("listed pins = %v, want [%s]", listed, second)
	}
}

func TestPinnedEvaluationsCleared(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	first := createPinnedEvaluation(t, store, "First")
	if _, err := store.SetPinnedEvaluations([]string{first}); err != nil {
		t.Fatalf("set pins: %v", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	listed, err := store.ListPinnedEvaluations()
	if err != nil {
		t.Fatalf("list pins: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("listed pins = %v, want none", listed)
	}
}
