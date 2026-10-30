package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Posting fulfillment evaluation.

type fulfillmentEventJSON struct {
	Date                     IsoDate           `json:"date"`
	Sequence                 int               `json:"sequence"`
	PostingID                string            `json:"postingId"`
	RequestedAmount          float64           `json:"requestedAmount"`
	RealizedAmount           float64           `json:"realizedAmount"`
	DestinationLimitedAmount float64           `json:"destinationLimitedAmount"`
	UnfulfilledAmount        float64           `json:"unfulfilledAmount"`
	BindingConstraints       []types.JsonValue `json:"bindingConstraints"`
	AccountDeltas            []types.JsonValue `json:"accountDeltas"`
}

// PostingFulfillmentPathResult is the deterministic result shape.
type PostingFulfillmentPathResult struct {
	RequestedAmount          float64                `json:"requestedAmount"`
	RealizedAmount           float64                `json:"realizedAmount"`
	DestinationLimitedAmount float64                `json:"destinationLimitedAmount"`
	UnfulfilledAmount        float64                `json:"unfulfilledAmount"`
	CompletionRate           float64                `json:"completionRate"`
	FirstUnderfulfilledDate  *IsoDate               `json:"firstUnderfulfilledDate"`
	Events                   []fulfillmentEventJSON `json:"events"`
	Dates                    []map[string]any       `json:"dates"`
	Postings                 []map[string]any       `json:"postings"`
}

func (r *PostingFulfillmentPathResult) ToJSON() types.JsonValue {
	events := make([]types.JsonValue, len(r.Events))
	for i, event := range r.Events {
		events[i] = event
	}
	dates := make([]types.JsonValue, len(r.Dates))
	for i, date := range r.Dates {
		dates[i] = date
	}
	postings := make([]types.JsonValue, len(r.Postings))
	for i, posting := range r.Postings {
		postings[i] = posting
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
		"postings":                 postings,
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
		PostingID:                event.Origin.PostingID,
		RequestedAmount:          roundAmount(event.RequestedAmount),
		RealizedAmount:           roundAmount(event.RealizedAmount),
		DestinationLimitedAmount: fulfillment.DestinationLimitedAmount,
		UnfulfilledAmount:        fulfillment.UnfulfilledAmount,
		BindingConstraints:       constraints,
		AccountDeltas:            deltas,
	}
}

type postingTotals struct {
	requestedAmount          float64
	realizedAmount           float64
	destinationLimitedAmount float64
	unfulfilledAmount        float64
	firstUnderfulfilledDate  *string
}

// EvaluatePostingFulfillment evaluates fulfillment over the selected postings.
func EvaluatePostingFulfillment(path *types.ProjectionPath, config types.PostingFulfillmentConfig, includeDetails bool) *PostingFulfillmentPathResult {
	var selectedIDs map[string]bool
	if config.PostingIDs != nil {
		selectedIDs = map[string]bool{}
		for _, id := range config.PostingIDs {
			selectedIDs[id] = true
		}
	}
	evaluatedEvents := evaluateTransactionEvents(path)
	result := &PostingFulfillmentPathResult{Events: []fulfillmentEventJSON{}, Dates: []map[string]any{}, Postings: []map[string]any{}}
	totalsByPostingID := map[string]*postingTotals{}
	type dateTotals struct {
		totals postingTotals
	}
	totalsByDate := map[string]*dateTotals{}
	var overall postingTotals

	for _, evaluated := range evaluatedEvents {
		event := evaluated.event
		if selectedIDs != nil && !selectedIDs[event.Origin.PostingID] {
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
		postingID := event.Origin.PostingID
		postingTotalsEntry, ok := totalsByPostingID[postingID]
		if !ok {
			postingTotalsEntry = &postingTotals{}
			totalsByPostingID[postingID] = postingTotalsEntry
		}
		postingTotalsEntry.requestedAmount += event.RequestedAmount
		postingTotalsEntry.realizedAmount += event.RealizedAmount
		postingTotalsEntry.destinationLimitedAmount += evaluated.destinationLimited
		postingTotalsEntry.unfulfilledAmount += evaluated.unfulfilled
		if postingTotalsEntry.firstUnderfulfilledDate == nil && evaluated.unfulfilled > 0 {
			date := event.Date
			postingTotalsEntry.firstUnderfulfilledDate = &date
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
		for _, account := range path.EffectiveDocument.Accounts {
			accountByID[account.ID] = account
		}
	}
	if includeDetails {
		detailTransactions := ResolvedTransactionPostings(&path.EffectiveDocument)
		detailCaps := RuleCapsByID(&path.EffectiveDocument)
		for index := range detailTransactions {
			posting := &detailTransactions[index]
			if posting.Purchase != nil {
				continue // Evaluation inputs are not established payment evidence.
			}
			if selectedIDs != nil && !selectedIDs[posting.ID] {
				continue
			}
			totals, ok := totalsByPostingID[posting.ID]
			if !ok {
				totals = &postingTotals{}
			}
			sourceLabel := (*string)(nil)
			if sourceAccount, ok := PostingSourceAccount(posting); ok {
				name := sourceAccount
				if account, ok := accountByID[sourceAccount]; ok {
					name = account.Name
				}
				sourceLabel = &name
			}
			var destinations any
			if posting.Destinations != nil {
				destList := []map[string]string{}
				for _, accountID := range posting.Destinations {
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
			var annualCap any
			if cap, ok := detailCaps[posting.ID]; ok {
				annualCap = cap
			}
			entry := map[string]any{
				"postingId":                posting.ID,
				"name":                     posting.Name,
				"sourceAccountId":          posting.SourceAccountID,
				"sourceAccountLabel":       sourceLabel,
				"destinations":             destinations,
				"annualCap":                annualCap,
				"requestedAmount":          roundAmount(totals.requestedAmount),
				"realizedAmount":           roundAmount(totals.realizedAmount),
				"destinationLimitedAmount": roundAmount(totals.destinationLimitedAmount),
				"utilizationRate":          utilizationRate,
				"completionRate":           completionRate,
				"firstUnderfulfilledDate":  totals.firstUnderfulfilledDate,
				"unfulfilledAmount":        roundAmount(totals.unfulfilledAmount),
			}
			result.Postings = append(result.Postings, entry)
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

func diagnoseFulfillmentConfig(path *types.ProjectionPath, config types.PostingFulfillmentConfig) []types.EvaluationDiagnostic {
	if config.PostingIDs == nil {
		return nil
	}
	postingIDs := TransactionIDs(&path.EffectiveDocument)
	diagnostics := []types.EvaluationDiagnostic{}
	for _, postingID := range config.PostingIDs {
		if !postingIDs[postingID] {
			diagnostics = append(diagnostics, types.EvaluationDiagnostic{
				Code:              "posting-fulfillment.posting.missing",
				Severity:          "warning",
				Message:           "Posting '" + postingID + "' does not exist.",
				RelatedPostingIDs: []string{postingID},
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

var postingFulfillmentDefinition = &EvaluationDefinition{
	Type: types.EvaluationTypePostingFulfillment,
	Name: "Posting fulfillment",

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
		typed := config.(types.PostingFulfillmentConfig)
		// Served projections always use summary detail: the only reader of
		// this envelope takes scalars (firstUnderfulfilledDate,
		// completionRate) while per-event evidence travels once on the
		// public transactionEvents timeline. Building the per-event, per-date,
		// and per-posting arrays here duplicated those 7446 events (~2.3 MB).
		// EvaluatePostingFulfillment keeps its detail capability for direct
		// callers; the served path never pays for it.
		return EvaluatePostingFulfillment(ctx.Path, typed, false), nil
	},
	DiagnoseConfig: func(ctx *EvaluationContext, config any) []types.EvaluationDiagnostic {
		return diagnoseFulfillmentConfig(ctx.Path, config.(types.PostingFulfillmentConfig))
	},

	CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
		return &fulfillmentAccumulator{unfulfilledAmounts: []float64{}}, nil
	},
	Accumulate: func(accumulator Accumulator, pathResult PathResult) error {
		acc := accumulator.(*fulfillmentAccumulator)
		result := pathResult.(*PostingFulfillmentPathResult)
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
		if deterministic != nil && deterministic.(*PostingFulfillmentPathResult).FirstUnderfulfilledDate == nil {
			return types.StatusSatisfied
		}
		return types.StatusNotSatisfied
	},
}
