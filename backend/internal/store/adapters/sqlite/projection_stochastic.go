package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type projectionExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

type projectionQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// SaveStochasticProjection publishes one complete range. The state guard runs
// before artifact replacement and every later statement shares the transaction,
// so a failure restores both the prior completion marker and prior artifacts.
func (s *sqliteStore) SaveStochasticProjection(write store.StochasticProjectionWrite) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, fmt.Errorf("save stochastic projection: %w", err)
	}
	defer tx.Rollback()

	allowSync := 0
	if write.AllowSettingsSync {
		allowSync = 1
	}
	result, err := tx.Exec(`UPDATE projection_states
		SET trial_count = ?, stochastic_seed = ?, stoch_evaluations_json = ?, published_revision = revision, dirty_from = 0
		WHERE id = ? AND revision = ? AND dirty_from = ? AND (
			(? = 1 AND trial_count = ? AND stochastic_seed IS NULL AND stoch_evaluations_json = '')
			OR (trial_count = ? AND stochastic_seed IS NULL AND stoch_evaluations_json = '')
			OR (trial_count = ? AND stochastic_seed IS ?)
		) AND user_id = :user_id`,
		write.TrialCount, nullable(write.Seed), write.EvaluationsJSON, write.StateID, write.Revision, write.DirtyFrom,
		allowSync, write.PreviousTrialCount, write.TrialCount, write.TrialCount, nullable(write.Seed))
	if err != nil {
		return false, fmt.Errorf("guard stochastic projection: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("guard stochastic projection rows: %w", err)
	}
	if updated == 0 {
		return false, nil
	}

	rows, err := tx.Query(`SELECT id FROM projection_slices WHERE projection_state_id = ? AND user_id = :user_id ORDER BY from_at, id`, write.StateID)
	if err != nil {
		return false, fmt.Errorf("list stochastic projection slices: %w", err)
	}
	sliceIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, fmt.Errorf("scan stochastic projection slice: %w", err)
		}
		sliceIDs = append(sliceIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, fmt.Errorf("iterate stochastic projection slices: %w", err)
	}
	rows.Close()

	if err := deleteMonteCarloStatistics(tx, sliceIDs); err != nil {
		return false, err
	}
	if err := saveMonteCarloStatistics(tx, write.Statistics); err != nil {
		return false, err
	}
	if err := clearEvaluationOutputs(tx, write.StateID, "stochastic"); err != nil {
		return false, err
	}
	if err := saveNetWorthThresholdOutputs(tx, write.StateID, "stochastic", write.Outputs.NetWorthThreshold, write.Revision); err != nil {
		return false, err
	}
	if err := saveAccountBalanceOutputs(tx, write.StateID, "stochastic", write.Outputs.AccountBalance, write.Revision); err != nil {
		return false, err
	}
	if err := saveTransactionFulfillmentOutputs(tx, write.StateID, "stochastic", write.Outputs.TransactionFulfillment, write.Revision); err != nil {
		return false, err
	}
	if err := saveCycleFulfillmentOutputs(tx, write.StateID, "stochastic", write.Outputs.CycleFulfillment, write.Revision); err != nil {
		return false, err
	}
	if err := savePlannedPurchasesOutputs(tx, write.StateID, "stochastic", write.Outputs.PlannedPurchases, write.Revision); err != nil {
		return false, err
	}
	if err := saveFinancialIndependenceOutputs(tx, write.StateID, "stochastic", write.Outputs.FinancialIndependence, write.Revision); err != nil {
		return false, err
	}
	if err := saveWhatIfOutputs(tx, write.StateID, "stochastic", write.Outputs.WhatIf, write.Revision); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit stochastic projection: %w", err)
	}
	return true, nil
}

func clearEvaluationOutputs(db projectionExecer, stateID, kind string) error {
	for _, table := range projectionOutputTables {
		if _, err := db.Exec(`DELETE FROM `+table+` WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
			return fmt.Errorf("clear projection outputs %s: %w", table, err)
		}
	}
	return nil
}

// ReadStochasticProjection reads every part of a published range from one
// transaction snapshot. A concurrent publisher therefore cannot mix old
// statistics with new evaluation outputs in the returned result.
func (s *sqliteStore) ReadStochasticProjection(stateID, kind string, revision int64, evaluationsJSON string) (*store.StochasticProjectionRead, bool, error) {
	if stateID == "" {
		stateID = defaultProjectionStateID
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false, fmt.Errorf("read stochastic projection: %w", err)
	}
	defer tx.Rollback()

	state, err := scanProjectionState(tx.QueryRow(`SELECT id, scope_id, revision, published_revision, dirty_from, projection_start, horizon_end, calendar_timezone, engine_version, trial_count, stochastic_seed, det_evaluations_json, stoch_evaluations_json FROM projection_states WHERE id = ? AND revision = ? AND published_revision = revision AND dirty_from = 0 AND stoch_evaluations_json = ? AND user_id = :user_id`, stateID, revision, evaluationsJSON))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read stochastic projection state: %w", err)
	}

	rows, err := tx.Query(`SELECT id, projection_state_id, from_at, to_at, built_revision, status FROM projection_slices WHERE projection_state_id = ? AND user_id = :user_id ORDER BY from_at, id`, stateID)
	if err != nil {
		return nil, false, fmt.Errorf("read stochastic projection slices: %w", err)
	}
	slices := []types.ProjectionSlice{}
	for rows.Next() {
		var slice types.ProjectionSlice
		if err := rows.Scan(&slice.ID, &slice.ProjectionStateID, &slice.FromAt, &slice.ToAt, &slice.BuiltRevision, &slice.Status); err != nil {
			rows.Close()
			return nil, false, fmt.Errorf("scan stochastic projection slice: %w", err)
		}
		if slice.BuiltRevision != revision {
			rows.Close()
			return nil, false, nil
		}
		slices = append(slices, slice)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, false, fmt.Errorf("iterate stochastic projection slices: %w", err)
	}
	rows.Close()
	if len(slices) == 0 {
		return nil, false, nil
	}
	sliceIDs := make([]string, 0, len(slices))
	for _, slice := range slices {
		sliceIDs = append(sliceIDs, slice.ID)
	}

	statistics, err := listMonteCarloStatistics(tx, sliceIDs)
	if err != nil {
		return nil, false, err
	}
	projectionDates, err := listProjectionDates(tx, sliceIDs)
	if err != nil {
		return nil, false, err
	}
	outputs := store.StochasticEvaluationOutputs{}
	if outputs.NetWorthThreshold, err = listNetWorthThresholdOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	if outputs.AccountBalance, err = listAccountBalanceOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	if outputs.TransactionFulfillment, err = listTransactionFulfillmentOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	if outputs.CycleFulfillment, err = listCycleFulfillmentOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	if outputs.PlannedPurchases, err = listPlannedPurchasesOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	if outputs.FinancialIndependence, err = listFinancialIndependenceOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	if outputs.WhatIf, err = listWhatIfOutputs(tx, stateID, kind); err != nil {
		return nil, false, err
	}
	return &store.StochasticProjectionRead{
		State: state, Slices: slices, Statistics: statistics,
		ProjectionDates: projectionDates, Outputs: outputs,
	}, true, nil
}

func listProjectionDates(db projectionQueryer, sliceIDs []string) ([]string, error) {
	dates := []string{}
	if len(sliceIDs) == 0 {
		return dates, nil
	}
	placeholders, args := sliceIDArgs(sliceIDs)
	rows, err := db.Query(`SELECT date FROM projection_rows WHERE projection_slice_id IN (`+placeholders+`) AND user_id = :user_id ORDER BY date`, args...)
	if err != nil {
		return nil, fmt.Errorf("list stochastic projection dates: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			return nil, fmt.Errorf("scan stochastic projection date: %w", err)
		}
		dates = append(dates, date)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate stochastic projection dates: %w", err)
	}
	return dates, nil
}
