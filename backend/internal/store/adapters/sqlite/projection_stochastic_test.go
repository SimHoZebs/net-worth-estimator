package sqlite

import (
	"fmt"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func stochasticProjectionTestWrite(stateID string, revision int64, slices []types.ProjectionSlice, value float64, fingerprint string) store.StochasticProjectionWrite {
	seed := int64(42)
	probability := value / 400
	return store.StochasticProjectionWrite{
		StateID: stateID, Revision: revision, TrialCount: 400, Seed: &seed,
		EvaluationsJSON: fingerprint, PreviousTrialCount: 1000, AllowSettingsSync: true,
		Statistics: []types.MonteCarloStatistic{
			{ProjectionSliceID: slices[0].ID, AsOfAt: "2026-06-01T00:00:00Z", P10: value - 2, P25: value - 1, P50: value, P75: value + 1, P90: value + 2},
			{ProjectionSliceID: slices[1].ID, AsOfAt: "2027-06-01T00:00:00Z", P10: value - 2, P25: value - 1, P50: value, P75: value + 1, P90: value + 2},
		},
		Outputs: store.StochasticEvaluationOutputs{NetWorthThreshold: []types.NetWorthThresholdOutput{{
			EvaluationOutputBase: types.EvaluationOutputBase{
				StateID: stateID, Kind: "stochastic", InstanceID: "threshold", Name: "Threshold",
				Status: "satisfied", DiagnosticsJSON: "[]", BuiltRevision: revision, HasProbabilistic: true,
			},
			ProbProbability: &probability,
		}}},
	}
}

func seedStochasticProjectionTest(t *testing.T) (*sqliteStore, []types.ProjectionSlice, store.StochasticProjectionWrite) {
	t.Helper()
	s := privateTestPlan(t, openSharedTestDatabase(t), "stochastic-atomic")
	if _, err := s.SaveProjectionState(types.ProjectionState{
		ID: "default", Revision: 1, PublishedRevision: 1,
		ProjectionStart: "2026-01-01", HorizonEnd: "2028-01-01", TrialCount: 1000,
	}); err != nil {
		t.Fatal(err)
	}
	first, err := s.SaveProjectionSlice(newProjectionSlice("2026-01-01", "2027-01-01", 1))
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.SaveProjectionSlice(newProjectionSlice("2027-01-01", "2028-01-01", 1))
	if err != nil {
		t.Fatal(err)
	}
	slices := []types.ProjectionSlice{first, second}
	if err := s.SaveProjectionRows([]ProjectionRowPayload{
		{SliceID: first.ID, Date: "2026-06-01", Payload: `{}`},
		{SliceID: second.ID, Date: "2027-06-01", Payload: `{}`},
	}); err != nil {
		t.Fatal(err)
	}
	write := stochasticProjectionTestWrite("default", 1, slices, 100, `{"range":"original"}`)
	if published, err := s.SaveStochasticProjection(write); err != nil || !published {
		stored, _ := s.GetProjectionState()
		t.Fatalf("seed stochastic projection: published=%v err=%v state=%+v write=%+v", published, err, stored, write)
	}
	return s, slices, write
}

func TestSaveStochasticProjectionRollsBackPartialWrite(t *testing.T) {
	s, slices, original := seedStochasticProjectionTest(t)
	if _, err := s.db.DB.Exec(`CREATE TRIGGER fail_second_statistic
		BEFORE INSERT ON monte_carlo_statistics
		WHEN NEW.as_of_at = '2027-06-01T00:00:00Z'
		BEGIN SELECT RAISE(ABORT, 'forced statistic failure'); END`); err != nil {
		t.Fatal(err)
	}
	defer s.db.DB.Exec(`DROP TRIGGER IF EXISTS fail_second_statistic`)

	replacement := stochasticProjectionTestWrite("default", 1, slices, 200, `{"range":"replacement"}`)
	replacement.AllowSettingsSync = false
	if published, err := s.SaveStochasticProjection(replacement); err == nil || published {
		t.Fatalf("partial replacement: published=%v err=%v", published, err)
	}
	snapshot, served, err := s.ReadStochasticProjection("default", "stochastic", 1, original.EvaluationsJSON)
	if err != nil || !served {
		t.Fatalf("read original range: served=%v err=%v", served, err)
	}
	if len(snapshot.Statistics) != 2 || snapshot.Statistics[0].P50 != 100 || snapshot.Statistics[1].P50 != 100 {
		t.Fatalf("partial write changed original statistics: %+v", snapshot.Statistics)
	}
	if len(snapshot.Outputs.NetWorthThreshold) != 1 || snapshot.Outputs.NetWorthThreshold[0].ProbProbability == nil || *snapshot.Outputs.NetWorthThreshold[0].ProbProbability != 0.25 {
		t.Fatalf("partial write changed original evaluations: %+v", snapshot.Outputs.NetWorthThreshold)
	}
	if snapshot.State.TrialCount != 400 || snapshot.State.StochasticSeed == nil || *snapshot.State.StochasticSeed != 42 || snapshot.State.StochEvaluationsJSON != original.EvaluationsJSON {
		t.Fatalf("partial write changed completion state: %+v", snapshot.State)
	}

	stale := replacement
	stale.Revision++
	if published, err := s.SaveStochasticProjection(stale); err != nil || published {
		t.Fatalf("stale revision: published=%v err=%v", published, err)
	}
	otherCount := replacement
	otherCount.TrialCount = 3
	if published, err := s.SaveStochasticProjection(otherCount); err != nil || published {
		t.Fatalf("frozen count changed: published=%v err=%v", published, err)
	}
}

func TestReadStochasticProjectionConcurrentPublicationIsConsistent(t *testing.T) {
	s, slices, original := seedStochasticProjectionTest(t)
	done := make(chan struct{})
	type observation struct {
		count int
		err   error
	}
	readDone := make(chan observation, 1)
	go func() {
		count := 0
		for {
			select {
			case <-done:
				readDone <- observation{count: count}
				return
			default:
			}
			snapshot, served, err := s.ReadStochasticProjection("default", "stochastic", 1, original.EvaluationsJSON)
			if err != nil {
				readDone <- observation{err: err}
				return
			}
			if !served {
				readDone <- observation{err: fmt.Errorf("published range disappeared")}
				return
			}
			if snapshot.State.Revision != 1 || len(snapshot.Slices) != 2 || len(snapshot.Statistics) != 2 || len(snapshot.ProjectionDates) != 2 {
				readDone <- observation{err: fmt.Errorf("incomplete snapshot: %+v", snapshot)}
				return
			}
			if len(snapshot.Outputs.NetWorthThreshold) != 1 || snapshot.Outputs.NetWorthThreshold[0].BuiltRevision != 1 || snapshot.Outputs.NetWorthThreshold[0].ProbProbability == nil {
				readDone <- observation{err: fmt.Errorf("incomplete evaluation snapshot: %+v", snapshot.Outputs)}
				return
			}
			probability := *snapshot.Outputs.NetWorthThreshold[0].ProbProbability
			want := 100.0
			if probability == 0.5 {
				want = 200
			} else if probability != 0.25 {
				readDone <- observation{err: fmt.Errorf("unexpected probability %v", probability)}
				return
			}
			for _, stat := range snapshot.Statistics {
				if stat.P50 != want {
					readDone <- observation{err: fmt.Errorf("mixed range: probability=%v statistic=%v", probability, stat.P50)}
					return
				}
			}
			count++
		}
	}()

	for iteration := 0; iteration < 100; iteration++ {
		value := 100.0
		if iteration%2 == 0 {
			value = 200
		}
		write := stochasticProjectionTestWrite("default", 1, slices, value, original.EvaluationsJSON)
		write.AllowSettingsSync = false
		if published, err := s.SaveStochasticProjection(write); err != nil || !published {
			close(done)
			t.Fatalf("publish iteration %d: published=%v err=%v", iteration, published, err)
		}
	}
	close(done)
	select {
	case result := <-readDone:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.count == 0 {
			t.Fatal("concurrent reader observed no complete range")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("concurrent range reader did not finish")
	}
}
