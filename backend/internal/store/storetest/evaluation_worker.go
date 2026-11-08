package storetest

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func testEvaluationWorkerConformance(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	s := newStore(t)
	if _, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	// First claim should succeed once projection state exists via account create dirty path.
	run, snapshot, claimed, err := s.ClaimEvaluationWorkerRun()
	if err != nil || !claimed || snapshot.Revision < 0 {
		t.Fatalf("claim=%v snapshot=%+v err=%v", claimed, snapshot, err)
	}
	if err := s.CompleteEvaluationWorkerRun(run, ""); err != nil {
		t.Fatal(err)
	}
	runs, _, fp, err := s.ListEvaluationWorkerRuns()
	if err != nil || len(runs) != 1 || runs[0].State != "succeeded" || fp == "" {
		t.Fatalf("runs=%+v fp=%q err=%v", runs, fp, err)
	}
	if _, _, claimed, err := s.ClaimEvaluationWorkerRun(); err != nil || claimed {
		t.Fatalf("duplicate claimed=%v err=%v", claimed, err)
	}
	// Changing projection state invalidates fingerprint → new claim.
	if _, err := s.MarkProjectionDirty(0); err != nil {
		// Fresh DB may not have state yet; GetProjectionState creates one.
		_ = err
	}
	if _, _, claimed, err := s.ClaimEvaluationWorkerRun(); err != nil || !claimed {
		t.Fatalf("after dirty claim=%v err=%v", claimed, err)
	}
}
