package sqlite

import (
	"database/sql"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Typed evaluation output storage. Each evaluation persists in its own
// table with typed result columns; variable-length evidence stays verbatim
// JSON so served bytes match computed envelopes exactly.

// Null helpers map pointer fields to nullable columns and back.

func nullStringPtr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func nullFloatPtr(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func nullIntPtr(i *int) any {
	if i == nil {
		return nil
	}
	return *i
}

func nullBoolPtr(b *bool) any {
	if b == nil {
		return nil
	}
	if *b {
		return 1
	}
	return 0
}

func stringPtrOf(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	value := ns.String
	return &value
}

func floatPtrOf(nf sql.NullFloat64) *float64 {
	if !nf.Valid {
		return nil
	}
	value := nf.Float64
	return &value
}

func intPtrOf(ni sql.NullInt64) *int {
	if !ni.Valid {
		return nil
	}
	value := int(ni.Int64)
	return &value
}

func boolPtrOf(ni sql.NullInt64) *bool {
	if !ni.Valid {
		return nil
	}
	value := ni.Int64 != 0
	return &value
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// orJSON keeps verbatim evidence columns valid when a caller passes "".
func orJSON(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// evalBaseRow scans the shared leading columns of every output table.
type evalBaseRow struct {
	stateID     string
	kind        string
	instanceID  string
	position    int64
	name        string
	status      string
	diagnostics string
	revision    int64
	hasDet      int64
	hasProb     int64
}

func (b *evalBaseRow) pointers() []any {
	return []any{&b.stateID, &b.kind, &b.instanceID, &b.position, &b.name, &b.status, &b.diagnostics, &b.revision, &b.hasDet, &b.hasProb}
}

func (b *evalBaseRow) fill(out *types.EvaluationOutputBase) {
	out.StateID = b.stateID
	out.Kind = b.kind
	out.InstanceID = b.instanceID
	out.Position = int(b.position)
	out.Name = b.name
	out.Status = b.status
	out.DiagnosticsJSON = b.diagnostics
	out.BuiltRevision = b.revision
	out.HasDeterministic = b.hasDet != 0
	out.HasProbabilistic = b.hasProb != 0
}

// SaveNetWorthThresholdOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SaveNetWorthThresholdOutputs(stateID, kind string, outputs []types.NetWorthThresholdOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM net_worth_threshold_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear threshold outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO net_worth_threshold_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			nullBoolPtr(output.Reached), nullStringPtr(output.FirstReachedDate), nullFloatPtr(output.ProbProbability), nullStringPtr(output.ProbP10Date), nullStringPtr(output.ProbMedianDate), nullStringPtr(output.ProbP90Date)); err != nil {
			return fmt.Errorf("save threshold output: %w", err)
		}
	}
	return nil
}

// ListNetWorthThresholdOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListNetWorthThresholdOutputs(stateID, kind string) ([]types.NetWorthThresholdOutput, error) {
	out := []types.NetWorthThresholdOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date FROM net_worth_threshold_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list threshold outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.NetWorthThresholdOutput
		var base evalBaseRow
		var reached sql.NullInt64
		var firstReached, p10, median, p90 sql.NullString
		var probability sql.NullFloat64
		scan := append(base.pointers(), &reached, &firstReached, &probability, &p10, &median, &p90)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan threshold output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.Reached = boolPtrOf(reached)
		output.FirstReachedDate = stringPtrOf(firstReached)
		output.ProbProbability = floatPtrOf(probability)
		output.ProbP10Date = stringPtrOf(p10)
		output.ProbMedianDate = stringPtrOf(median)
		output.ProbP90Date = stringPtrOf(p90)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate threshold outputs: %w", err)
	}
	return out, nil
}

// SaveAccountBalanceOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SaveAccountBalanceOutputs(stateID, kind string, outputs []types.AccountBalanceOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM account_balance_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear account balance outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO account_balance_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			nullBoolPtr(output.Reached), nullStringPtr(output.FirstReachedDate), nullFloatPtr(output.ProbProbability), nullStringPtr(output.ProbP10Date), nullStringPtr(output.ProbMedianDate), nullStringPtr(output.ProbP90Date)); err != nil {
			return fmt.Errorf("save account balance output: %w", err)
		}
	}
	return nil
}

// ListAccountBalanceOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListAccountBalanceOutputs(stateID, kind string) ([]types.AccountBalanceOutput, error) {
	out := []types.AccountBalanceOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, reached, first_reached_date, prob_probability, prob_p10_date, prob_median_date, prob_p90_date FROM account_balance_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list account balance outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.AccountBalanceOutput
		var base evalBaseRow
		var reached sql.NullInt64
		var firstReached, p10, median, p90 sql.NullString
		var probability sql.NullFloat64
		scan := append(base.pointers(), &reached, &firstReached, &probability, &p10, &median, &p90)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan account balance output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.Reached = boolPtrOf(reached)
		output.FirstReachedDate = stringPtrOf(firstReached)
		output.ProbProbability = floatPtrOf(probability)
		output.ProbP10Date = stringPtrOf(p10)
		output.ProbMedianDate = stringPtrOf(median)
		output.ProbP90Date = stringPtrOf(p90)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate account balance outputs: %w", err)
	}
	return out, nil
}

// SavePostingFulfillmentOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SavePostingFulfillmentOutputs(stateID, kind string, outputs []types.PostingFulfillmentOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM posting_fulfillment_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear fulfillment outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO posting_fulfillment_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, requested_amount, realized_amount, destination_limited_amount, unfulfilled_amount, completion_rate, first_underfulfilled_date, events_json, dates_json, postings_json, prob_run_count, prob_fulfilled_count, prob_full_probability, prob_unfulfilled_p10, prob_unfulfilled_p25, prob_unfulfilled_p50, prob_unfulfilled_p75, prob_unfulfilled_p90, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			nullFloatPtr(output.RequestedAmount), nullFloatPtr(output.RealizedAmount), nullFloatPtr(output.DestinationLimitedAmount), nullFloatPtr(output.UnfulfilledAmount), nullFloatPtr(output.CompletionRate), nullStringPtr(output.FirstUnderfulfilledDate),
			orJSON(output.EventsJSON, "[]"), orJSON(output.DatesJSON, "[]"), orJSON(output.PostingsJSON, "[]"),
			nullIntPtr(output.ProbRunCount), nullIntPtr(output.ProbFulfilledCount), nullFloatPtr(output.ProbFullProbability),
			nullFloatPtr(output.ProbUnfulfilledP10), nullFloatPtr(output.ProbUnfulfilledP25), nullFloatPtr(output.ProbUnfulfilledP50), nullFloatPtr(output.ProbUnfulfilledP75), nullFloatPtr(output.ProbUnfulfilledP90)); err != nil {
			return fmt.Errorf("save fulfillment output: %w", err)
		}
	}
	return nil
}

// ListPostingFulfillmentOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListPostingFulfillmentOutputs(stateID, kind string) ([]types.PostingFulfillmentOutput, error) {
	out := []types.PostingFulfillmentOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, requested_amount, realized_amount, destination_limited_amount, unfulfilled_amount, completion_rate, first_underfulfilled_date, events_json, dates_json, postings_json, prob_run_count, prob_fulfilled_count, prob_full_probability, prob_unfulfilled_p10, prob_unfulfilled_p25, prob_unfulfilled_p50, prob_unfulfilled_p75, prob_unfulfilled_p90 FROM posting_fulfillment_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list fulfillment outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.PostingFulfillmentOutput
		var base evalBaseRow
		var requested, realized, destLimited, unfulfilled, completion, probProb, p10, p25, p50, p75, p90 sql.NullFloat64
		var firstUnderfulfilled sql.NullString
		var runCount, fulfilledCount sql.NullInt64
		scan := append(base.pointers(), &requested, &realized, &destLimited, &unfulfilled, &completion, &firstUnderfulfilled, &output.EventsJSON, &output.DatesJSON, &output.PostingsJSON, &runCount, &fulfilledCount, &probProb, &p10, &p25, &p50, &p75, &p90)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan fulfillment output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.RequestedAmount = floatPtrOf(requested)
		output.RealizedAmount = floatPtrOf(realized)
		output.DestinationLimitedAmount = floatPtrOf(destLimited)
		output.UnfulfilledAmount = floatPtrOf(unfulfilled)
		output.CompletionRate = floatPtrOf(completion)
		output.FirstUnderfulfilledDate = stringPtrOf(firstUnderfulfilled)
		output.ProbRunCount = intPtrOf(runCount)
		output.ProbFulfilledCount = intPtrOf(fulfilledCount)
		output.ProbFullProbability = floatPtrOf(probProb)
		output.ProbUnfulfilledP10 = floatPtrOf(p10)
		output.ProbUnfulfilledP25 = floatPtrOf(p25)
		output.ProbUnfulfilledP50 = floatPtrOf(p50)
		output.ProbUnfulfilledP75 = floatPtrOf(p75)
		output.ProbUnfulfilledP90 = floatPtrOf(p90)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fulfillment outputs: %w", err)
	}
	return out, nil
}

// SaveCycleFulfillmentOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SaveCycleFulfillmentOutputs(stateID, kind string, outputs []types.CycleFulfillmentOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM cycle_fulfillment_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear cycle outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO cycle_fulfillment_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, account_ids_json, statement_day, budget, cycle_start, cycle_end, window_start, days_total, days_left, recorded_spend, scheduled_spend, spent, remaining, within_budget, shortfall, prob_run_count, prob_within_count, prob_within_probability, prob_spent_p10, prob_spent_p25, prob_spent_p50, prob_spent_p75, prob_spent_p90, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			orJSON(output.AccountIDsJSON, "[]"), nullIntPtr(output.StatementDay), nullFloatPtr(output.Budget), nullStringPtr(output.CycleStart), nullStringPtr(output.CycleEnd), nullStringPtr(output.WindowStart),
			nullIntPtr(output.DaysTotal), nullIntPtr(output.DaysLeft), nullFloatPtr(output.RecordedSpend), nullFloatPtr(output.ScheduledSpend), nullFloatPtr(output.Spent), nullFloatPtr(output.Remaining),
			nullBoolPtr(output.WithinBudget), nullFloatPtr(output.Shortfall),
			nullIntPtr(output.ProbRunCount), nullIntPtr(output.ProbWithinCount), nullFloatPtr(output.ProbWithinProbability),
			nullFloatPtr(output.ProbSpentP10), nullFloatPtr(output.ProbSpentP25), nullFloatPtr(output.ProbSpentP50), nullFloatPtr(output.ProbSpentP75), nullFloatPtr(output.ProbSpentP90)); err != nil {
			return fmt.Errorf("save cycle output: %w", err)
		}
	}
	return nil
}

// ListCycleFulfillmentOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListCycleFulfillmentOutputs(stateID, kind string) ([]types.CycleFulfillmentOutput, error) {
	out := []types.CycleFulfillmentOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, account_ids_json, statement_day, budget, cycle_start, cycle_end, window_start, days_total, days_left, recorded_spend, scheduled_spend, spent, remaining, within_budget, shortfall, prob_run_count, prob_within_count, prob_within_probability, prob_spent_p10, prob_spent_p25, prob_spent_p50, prob_spent_p75, prob_spent_p90 FROM cycle_fulfillment_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list cycle outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.CycleFulfillmentOutput
		var base evalBaseRow
		var statementDay, daysTotal, daysLeft, withinBudget, probRunCount, probWithinCount sql.NullInt64
		var budget, recorded, scheduled, spent, remaining, shortfall, probProb, p10, p25, p50, p75, p90 sql.NullFloat64
		var cycleStart, cycleEnd, windowStart sql.NullString
		scan := append(base.pointers(), &output.AccountIDsJSON, &statementDay, &budget, &cycleStart, &cycleEnd, &windowStart, &daysTotal, &daysLeft, &recorded, &scheduled, &spent, &remaining, &withinBudget, &shortfall, &probRunCount, &probWithinCount, &probProb, &p10, &p25, &p50, &p75, &p90)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan cycle output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.StatementDay = intPtrOf(statementDay)
		output.Budget = floatPtrOf(budget)
		output.CycleStart = stringPtrOf(cycleStart)
		output.CycleEnd = stringPtrOf(cycleEnd)
		output.WindowStart = stringPtrOf(windowStart)
		output.DaysTotal = intPtrOf(daysTotal)
		output.DaysLeft = intPtrOf(daysLeft)
		output.RecordedSpend = floatPtrOf(recorded)
		output.ScheduledSpend = floatPtrOf(scheduled)
		output.Spent = floatPtrOf(spent)
		output.Remaining = floatPtrOf(remaining)
		output.WithinBudget = boolPtrOf(withinBudget)
		output.Shortfall = floatPtrOf(shortfall)
		output.ProbRunCount = intPtrOf(probRunCount)
		output.ProbWithinCount = intPtrOf(probWithinCount)
		output.ProbWithinProbability = floatPtrOf(probProb)
		output.ProbSpentP10 = floatPtrOf(p10)
		output.ProbSpentP25 = floatPtrOf(p25)
		output.ProbSpentP50 = floatPtrOf(p50)
		output.ProbSpentP75 = floatPtrOf(p75)
		output.ProbSpentP90 = floatPtrOf(p90)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cycle outputs: %w", err)
	}
	return out, nil
}

// SavePlannedPurchasesOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SavePlannedPurchasesOutputs(stateID, kind string, outputs []types.PlannedPurchasesOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM planned_purchases_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear purchases outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO planned_purchases_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, all_funded, first_reached_date, purchases_json, prob_probability, prob_p10_date, prob_median_date, prob_p90_date, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			nullBoolPtr(output.AllFunded), nullStringPtr(output.FirstReachedDate), orJSON(output.PurchasesJSON, "[]"),
			nullFloatPtr(output.ProbProbability), nullStringPtr(output.ProbP10Date), nullStringPtr(output.ProbMedianDate), nullStringPtr(output.ProbP90Date)); err != nil {
			return fmt.Errorf("save purchases output: %w", err)
		}
	}
	return nil
}

// ListPlannedPurchasesOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListPlannedPurchasesOutputs(stateID, kind string) ([]types.PlannedPurchasesOutput, error) {
	out := []types.PlannedPurchasesOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, all_funded, first_reached_date, purchases_json, prob_probability, prob_p10_date, prob_median_date, prob_p90_date FROM planned_purchases_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list purchases outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.PlannedPurchasesOutput
		var base evalBaseRow
		var allFunded sql.NullInt64
		var firstReached, p10, median, p90 sql.NullString
		var probability sql.NullFloat64
		scan := append(base.pointers(), &allFunded, &firstReached, &output.PurchasesJSON, &probability, &p10, &median, &p90)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan purchases output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.AllFunded = boolPtrOf(allFunded)
		output.FirstReachedDate = stringPtrOf(firstReached)
		output.ProbProbability = floatPtrOf(probability)
		output.ProbP10Date = stringPtrOf(p10)
		output.ProbMedianDate = stringPtrOf(median)
		output.ProbP90Date = stringPtrOf(p90)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate purchases outputs: %w", err)
	}
	return out, nil
}

// SaveFinancialIndependenceOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SaveFinancialIndependenceOutputs(stateID, kind string, outputs []types.FinancialIndependenceOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM financial_independence_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear FI outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO financial_independence_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, first_coverage_date, first_self_sustaining_date, detail_json, prob_success, prob_median_date, prob_self_sustaining_date, prob_self_sustaining_prob, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			nullStringPtr(output.FirstCoverageDate), nullStringPtr(output.FirstSelfSustainingDate), orJSON(output.DetailJSON, "{}"),
			nullFloatPtr(output.ProbSuccess), nullStringPtr(output.ProbMedianDate), nullStringPtr(output.ProbSelfSustainingDate), nullFloatPtr(output.ProbSelfSustainingProb)); err != nil {
			return fmt.Errorf("save FI output: %w", err)
		}
	}
	return nil
}

// ListFinancialIndependenceOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListFinancialIndependenceOutputs(stateID, kind string) ([]types.FinancialIndependenceOutput, error) {
	out := []types.FinancialIndependenceOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, first_coverage_date, first_self_sustaining_date, detail_json, prob_success, prob_median_date, prob_self_sustaining_date, prob_self_sustaining_prob FROM financial_independence_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list FI outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.FinancialIndependenceOutput
		var base evalBaseRow
		var firstCoverage, firstSelfSustaining, probMedianDate, probSelfSustainingDate sql.NullString
		var probSuccess, probSelfSustainingProb sql.NullFloat64
		scan := append(base.pointers(), &firstCoverage, &firstSelfSustaining, &output.DetailJSON, &probSuccess, &probMedianDate, &probSelfSustainingDate, &probSelfSustainingProb)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan FI output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.FirstCoverageDate = stringPtrOf(firstCoverage)
		output.FirstSelfSustainingDate = stringPtrOf(firstSelfSustaining)
		output.ProbSuccess = floatPtrOf(probSuccess)
		output.ProbMedianDate = stringPtrOf(probMedianDate)
		output.ProbSelfSustainingDate = stringPtrOf(probSelfSustainingDate)
		output.ProbSelfSustainingProb = floatPtrOf(probSelfSustainingProb)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate FI outputs: %w", err)
	}
	return out, nil
}

// SaveWhatIfOutputs replaces all stored rows for one state and kind.
func (s *sqliteStore) SaveWhatIfOutputs(stateID, kind string, outputs []types.WhatIfOutput, builtRevision int64) error {
	if _, err := s.db.Exec(`DELETE FROM whatif_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id`, stateID, kind); err != nil {
		return fmt.Errorf("clear what-if outputs: %w", err)
	}
	for _, output := range outputs {
		if _, err := s.db.Exec(`INSERT INTO whatif_outputs (projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, final_net_worth, transaction_count, first_unfulfilled_date, all_funded, prob_full_probability, prob_sample_count, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			stateID, kind, output.InstanceID, output.Position, output.Name, output.Status, output.DiagnosticsJSON, builtRevision, boolInt(output.HasDeterministic), boolInt(output.HasProbabilistic),
			nullFloatPtr(output.FinalNetWorth), nullIntPtr(output.TransactionCount), nullStringPtr(output.FirstUnfulfilledDate), nullBoolPtr(output.AllFunded),
			nullFloatPtr(output.ProbFullProbability), nullIntPtr(output.ProbSampleCount)); err != nil {
			return fmt.Errorf("save what-if output: %w", err)
		}
	}
	return nil
}

// ListWhatIfOutputs returns stored rows for one state and kind in order.
func (s *sqliteStore) ListWhatIfOutputs(stateID, kind string) ([]types.WhatIfOutput, error) {
	out := []types.WhatIfOutput{}
	rows, err := s.db.Query(`SELECT projection_state_id, kind, instance_id, position, name, status, diagnostics_json, built_revision, has_deterministic, has_probabilistic, final_net_worth, transaction_count, first_unfulfilled_date, all_funded, prob_full_probability, prob_sample_count FROM whatif_outputs WHERE projection_state_id = ? AND kind = ? AND user_id = :user_id ORDER BY position`, stateID, kind)
	if err != nil {
		return nil, fmt.Errorf("list what-if outputs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var output types.WhatIfOutput
		var base evalBaseRow
		var finalNetWorth sql.NullFloat64
		var transactionCount, probSampleCount sql.NullInt64
		var firstUnfulfilled sql.NullString
		var allFunded sql.NullInt64
		var probFull sql.NullFloat64
		scan := append(base.pointers(), &finalNetWorth, &transactionCount, &firstUnfulfilled, &allFunded, &probFull, &probSampleCount)
		if err := rows.Scan(scan...); err != nil {
			return nil, fmt.Errorf("scan what-if output: %w", err)
		}
		base.fill(&output.EvaluationOutputBase)
		output.FinalNetWorth = floatPtrOf(finalNetWorth)
		output.TransactionCount = intPtrOf(transactionCount)
		output.FirstUnfulfilledDate = stringPtrOf(firstUnfulfilled)
		output.AllFunded = boolPtrOf(allFunded)
		output.ProbFullProbability = floatPtrOf(probFull)
		output.ProbSampleCount = intPtrOf(probSampleCount)
		out = append(out, output)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate what-if outputs: %w", err)
	}
	return out, nil
}
