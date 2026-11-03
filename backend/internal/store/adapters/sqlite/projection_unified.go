package sqlite

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const defaultProjectionStateID = "default"

// GetProjectionState returns the single state row, creating it on first use.
func (s *sqliteStore) GetProjectionState() (types.ProjectionState, error) {
	var state types.ProjectionState
	var seed sql.NullInt64
	err := s.db.QueryRow(`SELECT id, scope_id, revision, published_revision, dirty_from, projection_start, horizon_end, calendar_timezone, engine_version, trial_count, stochastic_seed FROM projection_states WHERE id = ? AND user_id = :user_id`, defaultProjectionStateID).Scan(
		&state.ID, &state.ScopeID, &state.Revision, &state.PublishedRevision, &state.DirtyFrom, &state.ProjectionStart, &state.HorizonEnd, &state.CalendarTimezone, &state.EngineVersion, &state.TrialCount, &seed)
	if err != nil {
		if err == sql.ErrNoRows {
			fresh := types.UnifiedProjectionDefaults()
			fresh.ID = defaultProjectionStateID
			return s.SaveProjectionState(fresh)
		}
		return types.ProjectionState{}, fmt.Errorf("read projection state: %w", err)
	}
	if seed.Valid {
		v := seed.Int64
		state.StochasticSeed = &v
	}
	return state, nil
}

// SaveProjectionState upserts the single state row.
func (s *sqliteStore) SaveProjectionState(state types.ProjectionState) (types.ProjectionState, error) {
	if state.ID == "" {
		state.ID = defaultProjectionStateID
	}
	if state.CalendarTimezone == "" {
		state.CalendarTimezone = "UTC"
	}
	if state.EngineVersion == "" {
		state.EngineVersion = "v1"
	}
	if state.TrialCount <= 0 {
		state.TrialCount = 1000
	}
	var seed any
	if state.StochasticSeed != nil {
		seed = *state.StochasticSeed
	}
	if _, err := s.db.Exec(`INSERT INTO projection_states (id, scope_id, revision, published_revision, dirty_from, projection_start, horizon_end, calendar_timezone, engine_version, trial_count, stochastic_seed, user_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET scope_id = excluded.scope_id, revision = excluded.revision, published_revision = excluded.published_revision, dirty_from = excluded.dirty_from, projection_start = excluded.projection_start, horizon_end = excluded.horizon_end, calendar_timezone = excluded.calendar_timezone, engine_version = excluded.engine_version, trial_count = excluded.trial_count, stochastic_seed = excluded.stochastic_seed`,
		state.ID, state.ScopeID, state.Revision, state.PublishedRevision, state.DirtyFrom, state.ProjectionStart, state.HorizonEnd, state.CalendarTimezone, state.EngineVersion, state.TrialCount, seed); err != nil {
		return types.ProjectionState{}, fmt.Errorf("save projection state: %w", err)
	}
	return s.GetProjectionState()
}

// MarkProjectionDirty moves dirty_from to the earliest affected instant and bumps revision.
// The bump plus dirty update runs in one UPDATE so concurrent marks cannot lose increments.
func (s *sqliteStore) MarkProjectionDirty(dirtyFrom string) (types.ProjectionState, error) {
	state, err := s.GetProjectionState()
	if err != nil {
		return types.ProjectionState{}, err
	}
	if dirtyFrom == "" {
		dirtyFrom = state.ProjectionStart
	}
	if _, err := s.db.Exec(`UPDATE projection_states SET revision = revision + 1, dirty_from = CASE WHEN dirty_from = '' OR dirty_from > ? THEN ? ELSE dirty_from END WHERE id = ? AND user_id = :user_id`, dirtyFrom, dirtyFrom, state.ID); err != nil {
		return types.ProjectionState{}, fmt.Errorf("mark projection dirty: %w", err)
	}
	return s.GetProjectionState()
}

// PublishProjection advances the published revision after a suffix build succeeds.
// It clears dirty_from only when no newer dirty arrived after the build started.
func (s *sqliteStore) PublishProjection(revision int64) (types.ProjectionState, error) {
	state, err := s.GetProjectionState()
	if err != nil {
		return types.ProjectionState{}, err
	}
	if _, err := s.db.Exec(`UPDATE projection_states SET published_revision = ?, dirty_from = '' WHERE id = ? AND revision = ? AND user_id = :user_id`, revision, state.ID, revision); err != nil {
		return types.ProjectionState{}, fmt.Errorf("publish projection: %w", err)
	}
	return s.GetProjectionState()
}

// ListProjectionSlices returns slices in from_at order.
func (s *sqliteStore) ListProjectionSlices() ([]types.ProjectionSlice, error) {
	rows, err := s.db.Query(`SELECT id, projection_state_id, from_at, to_at, built_revision, status FROM projection_slices WHERE user_id = :user_id ORDER BY from_at, id`)
	if err != nil {
		return nil, fmt.Errorf("list projection slices: %w", err)
	}
	defer rows.Close()
	out := []types.ProjectionSlice{}
	for rows.Next() {
		var sl types.ProjectionSlice
		if err := rows.Scan(&sl.ID, &sl.ProjectionStateID, &sl.FromAt, &sl.ToAt, &sl.BuiltRevision, &sl.Status); err != nil {
			return nil, fmt.Errorf("scan projection slice: %w", err)
		}
		out = append(out, sl)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projection slices: %w", err)
	}
	return out, nil
}

// SaveProjectionSlice upserts one slice.
func (s *sqliteStore) SaveProjectionSlice(slice types.ProjectionSlice) (types.ProjectionSlice, error) {
	if slice.ID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return types.ProjectionSlice{}, fmt.Errorf("slice id: %w", err)
		}
		slice.ID = id.String()
	}
	if slice.ProjectionStateID == "" {
		slice.ProjectionStateID = defaultProjectionStateID
	}
	if _, err := s.db.Exec(`INSERT INTO projection_slices (id, projection_state_id, from_at, to_at, built_revision, status, user_id)
		VALUES (?, ?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET projection_state_id = excluded.projection_state_id, from_at = excluded.from_at, to_at = excluded.to_at, built_revision = excluded.built_revision, status = excluded.status`,
		slice.ID, slice.ProjectionStateID, slice.FromAt, slice.ToAt, slice.BuiltRevision, slice.Status); err != nil {
		return types.ProjectionSlice{}, fmt.Errorf("save projection slice: %w", err)
	}
	return slice, nil
}

// DeleteProjectionSlicesFrom removes slices at or after fromAt plus their statistics.
func (s *sqliteStore) DeleteProjectionSlicesFrom(fromAt string) error {
	rows, err := s.db.Query(`SELECT id FROM projection_slices WHERE to_at >= ? AND user_id = :user_id`, fromAt)
	if err != nil {
		return fmt.Errorf("find suffix slices: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan suffix slice: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate suffix slices: %w", err)
	}
	for _, id := range ids {
		if _, err := s.db.Exec(`DELETE FROM monte_carlo_statistics WHERE projection_slice_id = ? AND user_id = :user_id`, id); err != nil {
			return fmt.Errorf("delete slice statistics: %w", err)
		}
		if _, err := s.db.Exec(`DELETE FROM projection_slices WHERE id = ? AND user_id = :user_id`, id); err != nil {
			return fmt.Errorf("delete suffix slice: %w", err)
		}
	}
	return nil
}

// ListMonteCarloStatistics returns statistics for one slice.
func (s *sqliteStore) ListMonteCarloStatistics(sliceID string) ([]types.MonteCarloStatistic, error) {
	rows, err := s.db.Query(`SELECT id, projection_slice_id, account_id, as_of_at, sample_count, mean, median, p10, p90, std_dev, probability_below_zero FROM monte_carlo_statistics WHERE projection_slice_id = ? AND user_id = :user_id ORDER BY account_id, as_of_at`, sliceID)
	if err != nil {
		return nil, fmt.Errorf("list statistics: %w", err)
	}
	defer rows.Close()
	out := []types.MonteCarloStatistic{}
	for rows.Next() {
		var st types.MonteCarloStatistic
		if err := rows.Scan(&st.ID, &st.ProjectionSliceID, &st.AccountID, &st.AsOfAt, &st.SampleCount, &st.Mean, &st.Median, &st.P10, &st.P90, &st.StdDev, &st.ProbabilityBelowZero); err != nil {
			return nil, fmt.Errorf("scan statistic: %w", err)
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate statistics: %w", err)
	}
	return out, nil
}

// SaveMonteCarloStatistics replaces statistics rows by id.
// Callers rebuild a slice by deleting suffix slices first with
// DeleteProjectionSlicesFrom, then saving fresh slices and statistics.
func (s *sqliteStore) SaveMonteCarloStatistics(stats []types.MonteCarloStatistic) error {
	for _, st := range stats {
		id := st.ID
		if id == "" {
			newID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("statistic id: %w", err)
			}
			id = newID.String()
		}
		if _, err := s.db.Exec(`INSERT INTO monte_carlo_statistics (id, projection_slice_id, account_id, as_of_at, sample_count, mean, median, p10, p90, std_dev, probability_below_zero, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)
			ON CONFLICT(user_id, id) DO UPDATE SET projection_slice_id = excluded.projection_slice_id, account_id = excluded.account_id, as_of_at = excluded.as_of_at, sample_count = excluded.sample_count, mean = excluded.mean, median = excluded.median, p10 = excluded.p10, p90 = excluded.p90, std_dev = excluded.std_dev, probability_below_zero = excluded.probability_below_zero`,
			id, st.ProjectionSliceID, st.AccountID, st.AsOfAt, st.SampleCount, st.Mean, st.Median, st.P10, st.P90, st.StdDev, st.ProbabilityBelowZero); err != nil {
			return fmt.Errorf("save statistic: %w", err)
		}
	}
	return nil
}

// ListProviderConnections returns connections in key order.
func (s *sqliteStore) ListProviderConnections() ([]types.ProviderConnection, error) {
	rows, err := s.db.Query(`SELECT id, provider_key, status, sync_cursor, last_synced_at FROM provider_connections WHERE user_id = :user_id ORDER BY provider_key`)
	if err != nil {
		return nil, fmt.Errorf("list provider connections: %w", err)
	}
	defer rows.Close()
	out := []types.ProviderConnection{}
	for rows.Next() {
		var c types.ProviderConnection
		if err := rows.Scan(&c.ID, &c.ProviderKey, &c.Status, &c.SyncCursor, &c.LastSyncedAt); err != nil {
			return nil, fmt.Errorf("scan provider connection: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate provider connections: %w", err)
	}
	return out, nil
}

// SaveProviderConnection upserts one connection.
func (s *sqliteStore) SaveProviderConnection(conn types.ProviderConnection) (types.ProviderConnection, error) {
	if conn.ID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return types.ProviderConnection{}, fmt.Errorf("connection id: %w", err)
		}
		conn.ID = id.String()
	}
	if _, err := s.db.Exec(`INSERT INTO provider_connections (id, provider_key, status, sync_cursor, last_synced_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET provider_key = excluded.provider_key, status = excluded.status, sync_cursor = excluded.sync_cursor, last_synced_at = excluded.last_synced_at`,
		conn.ID, conn.ProviderKey, conn.Status, conn.SyncCursor, conn.LastSyncedAt); err != nil {
		return types.ProviderConnection{}, fmt.Errorf("save provider connection: %w", err)
	}
	return conn, nil
}
