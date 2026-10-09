package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Cycle fulfillment evaluation. It asks a forward question of the
// projection: will the configured account set's combined statement-cycle
// spend stay within one total set-aside?
//
// The statement window derives from StatementDay anchored at the projection
// start, matching the frontend cycle view. Spend is realized outflow across
// the account set inside the window clipped to the projection horizon
// ([max(cycleStart, projectionStart), cycleEnd]). Recorded pre-start spend is
// represented in starting balances, not in this verdict; the frontend
// breakdown over recorded transactions remains the place to inspect what
// already happened.

// CycleFulfillmentPathResult is the deterministic result shape.
type CycleFulfillmentPathResult struct {
	AccountIDs     []string `json:"accountIds"`
	StatementDay   int      `json:"statementDay"`
	Budget         float64  `json:"budget"`
	CycleStart     IsoDate  `json:"cycleStart"`
	CycleEnd       IsoDate  `json:"cycleEnd"`
	WindowStart    IsoDate  `json:"windowStart"`
	DaysTotal      int      `json:"daysTotal"`
	DaysLeft       int      `json:"daysLeft"`
	RecordedSpend  float64  `json:"recordedSpend"`
	ScheduledSpend float64  `json:"scheduledSpend"`
	Spent          float64  `json:"spent"`
	Remaining      float64  `json:"remaining"`
	WithinBudget   bool     `json:"withinBudget"`
	Shortfall      float64  `json:"shortfall"`
}

func (r *CycleFulfillmentPathResult) ToJSON() types.JsonValue {
	return map[string]any{
		"accountIds":     r.AccountIDs,
		"statementDay":   r.StatementDay,
		"budget":         roundAmount(r.Budget),
		"cycleStart":     r.CycleStart,
		"cycleEnd":       r.CycleEnd,
		"windowStart":    r.WindowStart,
		"daysTotal":      r.DaysTotal,
		"daysLeft":       r.DaysLeft,
		"recordedSpend":  roundAmount(r.RecordedSpend),
		"scheduledSpend": roundAmount(r.ScheduledSpend),
		"spent":          roundAmount(r.Spent),
		"remaining":      roundAmount(r.Budget - r.Spent),
		"withinBudget":   r.WithinBudget,
		"shortfall":      roundAmount(r.Shortfall),
	}
}

// resolveStatementCycle anchors the statement window at statementDay (1-28)
// around todayIso. It returns the inclusive cycle start and the exclusive
// cycle end (the next anchor), so window tests use half-open intervals.
func resolveStatementCycle(todayIso string, statementDay int) (cycleStart, cycleEndExclusive string) {
	day := statementDay
	if day < 1 {
		day = 1
	}
	if day > 28 {
		day = 28
	}
	year, month, dayOfMonth := splitIsoDate(todayIso)
	startYear, startMonth := year, month
	if dayOfMonth < day {
		startMonth--
		if startMonth < 1 {
			startMonth = 12
			startYear--
		}
	}
	cycleStart = fmt.Sprintf("%04d-%02d-%02d", startYear, startMonth, day)
	return cycleStart, AddMonthsClamped(cycleStart, 1)
}

// cycleOutflow sums realized outflow magnitude for an account set on an
// event: negative account deltas. Payments into an account are positive
// deltas and never count as spend.
func cycleOutflow(event *types.MovementEvent, accountIDs map[string]bool) float64 {
	spent := 0.0
	for _, delta := range event.AccountDeltas {
		if accountIDs[delta.AccountID] && delta.Delta < 0 {
			spent += -delta.Delta
		}
	}
	return spent
}

// EvaluateCycleFulfillment measures realized cycle spend against budget.
//
// Spend has two parts. Recorded spend covers enabled one-time outflows dated
// in [cycleStart, projectionStart]: for a one-time posting the yearly
// realized bucket holds exactly its single replayed occurrence, so the
// bucket is precisely attributable. A start-date occurrence already covered
// by a movement event (no checkpoint suppression) is skipped to avoid double
// counting. Scheduled spend covers realized outflow in movement events dated
// in [windowStart, cycleEnd). Recurring history is checkpoint truth baked
// into starting balances, not attributable spend, so it stays out.
func EvaluateCycleFulfillment(path *types.ProjectionPath, config types.CycleFulfillmentConfig) *CycleFulfillmentPathResult {
	projectionStart := string(path.ProjectionStartDate)
	cycleStart, cycleEndExclusive := resolveStatementCycle(projectionStart, config.StatementDay)
	windowStart := cycleStart
	if CompareIsoDates(windowStart, projectionStart) < 0 {
		windowStart = projectionStart
	}
	// Inclusive display end is the day before the exclusive anchor.
	cycleEnd := FormatIsoDate(MustParseIsoDate(cycleEndExclusive).AddDate(0, 0, -1))
	accountSet := make(map[string]bool, len(config.AccountIDs))
	for _, id := range config.AccountIDs {
		accountSet[id] = true
	}
	startDateEvents := map[string]bool{}
	for index := range path.MovementEvents {
		event := &path.MovementEvents[index]
		if event.Date == projectionStart {
			startDateEvents[event.Origin.PostingID] = true
		}
	}
	recorded := 0.0
	for index := range path.EffectiveDocument.Postings {
		posting := &path.EffectiveDocument.Postings[index]
		if !posting.Enabled {
			continue
		}
		sourceAccount, ok := PostingSourceAccount(posting)
		if !ok || !accountSet[sourceAccount] {
			continue
		}
		if CompareIsoDates(posting.Date, cycleStart) < 0 || CompareIsoDates(posting.Date, projectionStart) > 0 {
			continue
		}
		if posting.Date == projectionStart && startDateEvents[posting.ID] {
			continue
		}
		if byYear, ok := path.ProjectionStartPostingState.RealizedPostingAmountsByYear[posting.ID]; ok {
			recorded += maxFloat(0, byYear[posting.Date[:4]])
		}
	}
	scheduled := 0.0
	for index := range path.MovementEvents {
		event := &path.MovementEvents[index]
		if CompareIsoDates(event.Date, windowStart) < 0 || CompareIsoDates(event.Date, cycleEndExclusive) >= 0 {
			continue
		}
		scheduled += cycleOutflow(event, accountSet)
	}
	spent := recorded + scheduled
	roundedSpent := roundAmount(spent)
	roundedBudget := roundAmount(config.Budget)
	shortfall := 0.0
	withinBudget := roundedSpent <= roundedBudget
	if !withinBudget {
		shortfall = roundedSpent - roundedBudget
	}
	return &CycleFulfillmentPathResult{
		AccountIDs:     append([]string(nil), config.AccountIDs...),
		StatementDay:   config.StatementDay,
		Budget:         config.Budget,
		CycleStart:     IsoDate(cycleStart),
		CycleEnd:       IsoDate(cycleEnd),
		WindowStart:    IsoDate(windowStart),
		DaysTotal:      DaysBetween(cycleStart, cycleEndExclusive),
		DaysLeft:       maxInt(0, DaysBetween(projectionStart, cycleEndExclusive)),
		RecordedSpend:  recorded,
		ScheduledSpend: scheduled,
		Spent:          spent,
		Remaining:      config.Budget - spent,
		WithinBudget:   withinBudget,
		Shortfall:      shortfall,
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func diagnoseCycleConfig(path *types.ProjectionPath, config types.CycleFulfillmentConfig) []types.EvaluationDiagnostic {
	diagnostics := []types.EvaluationDiagnostic{}
	byID := map[string]types.Account{}
	for _, account := range path.EffectiveDocument.Accounts {
		byID[account.ID] = account
	}
	for _, accountID := range config.AccountIDs {
		account, ok := byID[accountID]
		if !ok {
			diagnostics = append(diagnostics, types.EvaluationDiagnostic{
				Code:              "cycle-fulfillment.account.missing",
				Severity:          "warning",
				Message:           "Account '" + accountID + "' does not exist.",
				RelatedAccountIDs: []string{accountID},
			})
			continue
		}
		if !account.Enabled {
			diagnostics = append(diagnostics, types.EvaluationDiagnostic{
				Code:              "cycle-fulfillment.account.disabled",
				Severity:          "warning",
				Message:           "Account '" + accountID + "' is excluded, so its cycle spend is not tracked.",
				RelatedAccountIDs: []string{accountID},
			})
		}
	}
	return diagnostics
}

type cycleAccumulator struct {
	runCount          int
	withinBudgetCount int
	spentTotals       []float64
}

var cycleFulfillmentDefinition = &EvaluationDefinition{
	Type: types.EvaluationTypeCycleFulfillment,
	Name: "Cycle fulfillment",

	ValidateConfig: ValidateCycleFulfillmentConfig,
	ParseConfig: func(config any) (any, error) {
		parsed, err := ParseCycleFulfillmentConfig(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},

	EvaluatePath: func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.CycleFulfillmentConfig)
		return EvaluateCycleFulfillment(ctx.Path, typed), nil
	},
	DiagnoseConfig: func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic {
		return diagnoseCycleConfig(ctx.Path, config.(types.CycleFulfillmentConfig))
	},

	CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
		return &cycleAccumulator{spentTotals: []float64{}}, nil
	},
	Accumulate: func(accumulator Accumulator, pathResult PathResult) error {
		acc := accumulator.(*cycleAccumulator)
		result := pathResult.(*CycleFulfillmentPathResult)
		acc.runCount++
		if result.WithinBudget {
			acc.withinBudgetCount++
		}
		acc.spentTotals = append(acc.spentTotals, roundAmount(result.Spent))
		return nil
	},
	Finalize: func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error) {
		acc := accumulator.(*cycleAccumulator)
		probability := 0.0
		if acc.runCount > 0 {
			probability = float64(acc.withinBudgetCount) / float64(acc.runCount)
		}
		percentiles := ComputePercentiles(acc.spentTotals)
		return map[string]any{
			"runCount":                acc.runCount,
			"withinBudgetRunCount":    acc.withinBudgetCount,
			"withinBudgetProbability": probability,
			"spentPercentiles":        percentilesToJSON(percentiles),
		}, nil
	},
	Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
		if probabilistic != nil {
			probability, _ := probabilistic.(map[string]any)["withinBudgetProbability"].(float64)
			if probability == 1 {
				return types.StatusSatisfied
			}
			return types.StatusNotSatisfied
		}
		if deterministic != nil && deterministic.(*CycleFulfillmentPathResult).WithinBudget {
			return types.StatusSatisfied
		}
		return types.StatusNotSatisfied
	},
}
