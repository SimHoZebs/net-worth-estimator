package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Transaction fulfillment evaluation.

type fulfillmentEventJSON struct {
	Date                     IsoDate           `json:"date"`
	Sequence                 int               `json:"sequence"`
	TransactionID            string            `json:"transactionId"`
	RequestedAmount          float64           `json:"requestedAmount"`
	RealizedAmount           float64           `json:"realizedAmount"`
	DestinationLimitedAmount float64           `json:"destinationLimitedAmount"`
	UnfulfilledAmount        float64           `json:"unfulfilledAmount"`
	BindingConstraints       []types.JsonValue `json:"bindingConstraints"`
	AccountDeltas            []types.JsonValue `json:"accountDeltas"`
}

// TransactionFulfillmentPathResult is the deterministic result shape.
type TransactionFulfillmentPathResult struct {
	RequestedAmount          float64                `json:"requestedAmount"`
	RealizedAmount           float64                `json:"realizedAmount"`
	DestinationLimitedAmount float64                `json:"destinationLimitedAmount"`
	UnfulfilledAmount        float64                `json:"unfulfilledAmount"`
	CompletionRate           float64                `json:"completionRate"`
	FirstUnderfulfilledDate  *IsoDate               `json:"firstUnderfulfilledDate"`
	Events                   []fulfillmentEventJSON `json:"events"`
	Dates                    []map[string]any       `json:"dates"`
	Transactions             []map[string]any       `json:"transactions"`
}

func (r *TransactionFulfillmentPathResult) ToJSON() types.JsonValue {
	events := make([]types.JsonValue, len(r.Events))
	for i, event := range r.Events {
		events[i] = event
	}
	dates := make([]types.JsonValue, len(r.Dates))
	for i, date := range r.Dates {
		dates[i] = date
	}
	transactions := make([]types.JsonValue, len(r.Transactions))
	for i, transaction := range r.Transactions {
		transactions[i] = transaction
	}
	return map[string]any{
		"requestedAmount":          r.RequestedAmount,
		"realizedAmount":           r.RealizedAmount,
		"destinationLimitedAmount": r.DestinationLimitedAmount,
		"unfulfilledAmount":        r.UnfulfilledAmount,
		"completionRate":           r.CompletionRate,
		"firstUnderfulfilledDate":  r.FirstUnderfulfilledDate,
		"events":                   events,
		"dates":                    dates,
		"transactions":             transactions,
	}
}

// roundAmount is kept as an alias so fulfillment and cycle results use one
// currency rounding owner with path.go. mathRound stays separate: it rounds
// halves toward +Infinity for percentile buffers and differs on negative .5.
func roundAmount(value float64) float64 { return roundCurrency(value) }

func toFulfillmentEvent(evaluated evaluatedTransactionEvent) fulfillmentEventJSON {
	event := evaluated.event
	fulfillment := evaluated.fulfillment()
	constraints := make([]types.JsonValue, 0, len(evaluated.bindingConstraints))
	for _, constraint := range evaluated.bindingConstraints {
		constraints = append(constraints, constraint.toTypes())
	}
	deltas := make([]types.JsonValue, 0, len(event.AccountDeltas))
	for _, delta := range event.AccountDeltas {
		deltas = append(deltas, map[string]any{
			"accountId": delta.AccountID,
			"delta":     roundAmount(delta.Delta),
		})
	}
	return fulfillmentEventJSON{
		Date:                     event.Date,
		Sequence:                 event.Sequence,
		TransactionID:            event.Origin.TransactionID,
		RequestedAmount:          roundAmount(event.RequestedAmount),
		RealizedAmount:           roundAmount(event.RealizedAmount),
		DestinationLimitedAmount: fulfillment.DestinationLimitedAmount,
		UnfulfilledAmount:        fulfillment.UnfulfilledAmount,
		BindingConstraints:       constraints,
		AccountDeltas:            deltas,
	}
}

type transactionTotals struct {
	requestedAmount          float64
	realizedAmount           float64
	destinationLimitedAmount float64
	unfulfilledAmount        float64
	firstUnderfulfilledDate  *string
}

// EvaluateTransactionFulfillment evaluates fulfillment over the selected transactions.
func EvaluateTransactionFulfillment(path *types.ProjectionPath, config types.TransactionFulfillmentConfig, includeDetails bool) *TransactionFulfillmentPathResult {
	var selectedIDs map[string]bool
	if config.TransactionIDs != nil {
		selectedIDs = map[string]bool{}
		for _, id := range config.TransactionIDs {
			selectedIDs[id] = true
		}
	}
	evaluatedEvents := evaluateTransactionEvents(path)
	result := &TransactionFulfillmentPathResult{Events: []fulfillmentEventJSON{}, Dates: []map[string]any{}, Transactions: []map[string]any{}}
	totalsByTransactionID := map[string]*transactionTotals{}
	type dateTotals struct {
		totals transactionTotals
	}
	totalsByDate := map[string]*dateTotals{}
	var overall transactionTotals

	for _, evaluated := range evaluatedEvents {
		event := evaluated.event
		if selectedIDs != nil && !selectedIDs[event.Origin.TransactionID] {
			continue
		}
		overall.requestedAmount += event.RequestedAmount
		overall.realizedAmount += event.RealizedAmount
		overall.destinationLimitedAmount += evaluated.destinationLimited
		overall.unfulfilledAmount += evaluated.unfulfilled
		if overall.firstUnderfulfilledDate == nil && evaluated.unfulfilled > 0 {
			date := event.Date
			overall.firstUnderfulfilledDate = &date
		}
		if !includeDetails {
			continue
		}
		result.Events = append(result.Events, toFulfillmentEvent(evaluated))
		transactionID := event.Origin.TransactionID
		transactionTotalsEntry, ok := totalsByTransactionID[transactionID]
		if !ok {
			transactionTotalsEntry = &transactionTotals{}
			totalsByTransactionID[transactionID] = transactionTotalsEntry
		}
		transactionTotalsEntry.requestedAmount += event.RequestedAmount
		transactionTotalsEntry.realizedAmount += event.RealizedAmount
		transactionTotalsEntry.destinationLimitedAmount += evaluated.destinationLimited
		transactionTotalsEntry.unfulfilledAmount += evaluated.unfulfilled
		if transactionTotalsEntry.firstUnderfulfilledDate == nil && evaluated.unfulfilled > 0 {
			date := event.Date
			transactionTotalsEntry.firstUnderfulfilledDate = &date
		}
		dateEntry, ok := totalsByDate[event.Date]
		if !ok {
			dateEntry = &dateTotals{}
			totalsByDate[event.Date] = dateEntry
		}
		dateEntry.totals.requestedAmount += event.RequestedAmount
		dateEntry.totals.realizedAmount += event.RealizedAmount
		dateEntry.totals.destinationLimitedAmount += evaluated.destinationLimited
		dateEntry.totals.unfulfilledAmount += evaluated.unfulfilled
	}

	accountByID := map[string]types.Account{}
	if includeDetails {
		for _, account := range path.EffectiveModel.Accounts {
			accountByID[account.ID] = account
		}
	}
	if includeDetails {
		detailTransactions := ResolvedTransactionTransactions(&path.EffectiveModel)
		detailCaps := RuleCapsByID(&path.EffectiveModel)
		for index := range detailTransactions {
			transaction := &detailTransactions[index]
			if selectedIDs != nil && !selectedIDs[transaction.ID] {
				continue
			}
			totals, ok := totalsByTransactionID[transaction.ID]
			if !ok {
				totals = &transactionTotals{}
			}
			sourceLabel := (*string)(nil)
			if sourceAccount, ok := TransactionSourceAccount(transaction); ok {
				name := sourceAccount
				if account, ok := accountByID[sourceAccount]; ok {
					name = account.Name
				}
				sourceLabel = &name
			}
			var destinations any
			if transaction.Destinations != nil {
				destList := []map[string]string{}
				for _, accountID := range transaction.Destinations {
					name := accountID
					if account, ok := accountByID[accountID]; ok {
						name = account.Name
					}
					destList = append(destList, map[string]string{"accountId": accountID, "name": name})
				}
				destinations = destList
			}
			utilizationRate := 0.0
			if totals.requestedAmount > 0 {
				utilizationRate = totals.realizedAmount / totals.requestedAmount
			}
			completionRate := 1.0
			if totals.requestedAmount > 0 {
				completionRate = math.Max(0, 1-totals.unfulfilledAmount/totals.requestedAmount)
			}
			entry := map[string]any{
				"transactionId":            transaction.ID,
				"name":                     transaction.Name,
				"sourceAccountId":          transaction.SourceAccountID,
				"sourceAccountLabel":       sourceLabel,
				"destinations":             destinations,
				"requestedAmount":          roundAmount(totals.requestedAmount),
				"realizedAmount":           roundAmount(totals.realizedAmount),
				"destinationLimitedAmount": roundAmount(totals.destinationLimitedAmount),
				"utilizationRate":          utilizationRate,
				"completionRate":           completionRate,
				"firstUnderfulfilledDate":  totals.firstUnderfulfilledDate,
				"unfulfilledAmount":        roundAmount(totals.unfulfilledAmount),
			}
			if cap, ok := detailCaps[transaction.ID]; ok {
				entry["annualCap"] = cap
			}
			result.Transactions = append(result.Transactions, entry)
		}
	}

	dates := make([]string, 0, len(totalsByDate))
	for date := range totalsByDate {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	for _, date := range dates {
		totals := &totalsByDate[date].totals
		result.Dates = append(result.Dates, map[string]any{
			"date":                     date,
			"requestedAmount":          roundAmount(totals.requestedAmount),
			"realizedAmount":           roundAmount(totals.realizedAmount),
			"destinationLimitedAmount": roundAmount(totals.destinationLimitedAmount),
			"unfulfilledAmount":        roundAmount(totals.unfulfilledAmount),
		})
	}

	completionRate := 1.0
	if overall.requestedAmount > 0 {
		completionRate = math.Max(0, 1-overall.unfulfilledAmount/overall.requestedAmount)
	}
	result.RequestedAmount = roundAmount(overall.requestedAmount)
	result.RealizedAmount = roundAmount(overall.realizedAmount)
	result.DestinationLimitedAmount = roundAmount(overall.destinationLimitedAmount)
	result.UnfulfilledAmount = roundAmount(overall.unfulfilledAmount)
	result.CompletionRate = completionRate
	result.FirstUnderfulfilledDate = overall.firstUnderfulfilledDate
	return result
}

func diagnoseFulfillmentConfig(path *types.ProjectionPath, config types.TransactionFulfillmentConfig) []types.EvaluationDiagnostic {
	if config.TransactionIDs == nil {
		return nil
	}
	transactionIDs := TransactionIDs(&path.EffectiveModel)
	diagnostics := []types.EvaluationDiagnostic{}
	for _, transactionID := range config.TransactionIDs {
		if !transactionIDs[transactionID] {
			diagnostics = append(diagnostics, types.EvaluationDiagnostic{
				Code:                  "transaction-fulfillment.transaction.missing",
				Severity:              "warning",
				Message:               "Transaction '" + transactionID + "' does not exist.",
				RelatedTransactionIDs: []string{transactionID},
			})
		}
	}
	return diagnostics
}

type fulfillmentAccumulator struct {
	runCount           int
	fulfilledRunCount  int
	unfulfilledAmounts []float64
}

var transactionFulfillmentDefinition = &EvaluationDefinition{
	Type: types.EvaluationTypeTransactionFulfillment,
	Name: "Transaction fulfillment",

	// Reader: answers from the cached path's transaction events only.
	Kind: EvaluationKindReader,

	ValidateConfig: ValidateFulfillmentConfig,
	ParseConfig: func(config any) (any, error) {
		parsed, err := ParseFulfillmentConfig(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},

	EvaluatePath: func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.TransactionFulfillmentConfig)
		// Served projections always use summary detail: the only reader of
		// this envelope takes scalars (firstUnderfulfilledDate,
		// completionRate) while per-event evidence travels once on the
		// public transactionEvents timeline. Building the per-event, per-date,
		// and per-transaction arrays here duplicated those 7446 events (~2.3 MB).
		// EvaluateTransactionFulfillment keeps its detail capability for direct
		// callers; the served path never pays for it.
		return EvaluateTransactionFulfillment(ctx.Path, typed, false), nil
	},
	DiagnoseConfig: func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic {
		return diagnoseFulfillmentConfig(ctx.Path, config.(types.TransactionFulfillmentConfig))
	},

	CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
		return &fulfillmentAccumulator{unfulfilledAmounts: []float64{}}, nil
	},
	Accumulate: func(accumulator Accumulator, pathResult PathResult) error {
		acc := accumulator.(*fulfillmentAccumulator)
		result := pathResult.(*TransactionFulfillmentPathResult)
		acc.runCount++
		if result.FirstUnderfulfilledDate == nil {
			acc.fulfilledRunCount++
		}
		acc.unfulfilledAmounts = append(acc.unfulfilledAmounts, result.UnfulfilledAmount)
		return nil
	},
	Finalize: func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error) {
		acc := accumulator.(*fulfillmentAccumulator)
		probability := 0.0
		if acc.runCount > 0 {
			probability = float64(acc.fulfilledRunCount) / float64(acc.runCount)
		}
		percentiles := ComputePercentiles(acc.unfulfilledAmounts)
		return map[string]any{
			"runCount":                     acc.runCount,
			"fulfilledRunCount":            acc.fulfilledRunCount,
			"fullFulfillmentProbability":   probability,
			"unfulfilledAmountPercentiles": percentilesToJSON(percentiles),
		}, nil
	},
	Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
		if probabilistic != nil {
			probability, _ := probabilistic.(map[string]any)["fullFulfillmentProbability"].(float64)
			if probability == 1 {
				return types.StatusSatisfied
			}
			return types.StatusNotSatisfied
		}
		if deterministic != nil && deterministic.(*TransactionFulfillmentPathResult).FirstUnderfulfilledDate == nil {
			return types.StatusSatisfied
		}
		return types.StatusNotSatisfied
	},
}
