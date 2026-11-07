package model

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Transactions are recorded movements: facts. They are created, amended,
// claimed as a schedule occurrence, moved, categorized, and deleted. A
// transaction never becomes a schedule; starting a schedule from one creates
// a separate instruction and leaves the fact in place.

func timeOf(stamp int64) string {
	if stamp <= 0 {
		return "00:00:00"
	}
	return time.Unix(stamp, 0).UTC().Format("15:04:05")
}

func dayOf(stamp int64) types.IsoDate {
	if stamp <= 0 {
		return ""
	}
	return types.IsoDate(time.Unix(stamp, 0).UTC().Format("2006-01-02"))
}

// instantOf renders a calendar day and clock as a UTC instant. An empty clock
// means midnight.
func instantOf(date types.IsoDate, clock string) (int64, error) {
	if !domain.IsValidIsoDate(string(date)) {
		return 0, fmt.Errorf("date must be a YYYY-MM-DD calendar date")
	}
	if clock == "" {
		clock = "00:00:00"
	}
	if len(clock) == 5 {
		clock += ":00"
	}
	parsed, err := time.Parse("2006-01-02 15:04:05", string(date)+" "+clock)
	if err != nil {
		return 0, fmt.Errorf("time must be HH:MM or HH:MM:SS")
	}
	return parsed.Unix(), nil
}

func midnightOf(date types.IsoDate) (int64, error) {
	return instantOf(date, "00:00:00")
}

type transactionRecordBody struct {
	ID              *string                 `json:"id,omitempty" format:"uuid"`
	Name            string                  `json:"name"`
	SourceAccountID *string                 `json:"sourceAccountId,omitempty"`
	Destinations    []string                `json:"destinations,omitempty"`
	Amount          amountInput             `json:"amount"`
	Date            types.IsoDate           `json:"date"`
	Time            *string                 `json:"time,omitempty"`
	PostedDate      *types.IsoDate          `json:"postedDate,omitempty"`
	Enabled         bool                    `json:"enabled"`
	Claim           *types.TransactionClaim `json:"claim,omitempty"`
}

func (b transactionRecordBody) toTransaction(id string) (types.Transaction, error) {
	amount, err := b.Amount.literalResolution()
	if err != nil {
		return types.Transaction{}, err
	}
	transactionTime, err := instantOf(b.Date, derefString(b.Time))
	if err != nil {
		return types.Transaction{}, err
	}
	postedDate := b.Date
	if b.PostedDate != nil {
		postedDate = *b.PostedDate
	}
	postedTime, err := midnightOf(postedDate)
	if err != nil {
		return types.Transaction{}, err
	}
	out := types.Transaction{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: amount,
		PostedTime: postedTime, TransactionTime: transactionTime,
		Claim: b.Claim, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out, nil
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

type transactionAmendBody struct {
	Name            optional[string]                `json:"name,omitempty"`
	SourceAccountID nullableOptional[string]        `json:"sourceAccountId,omitempty"`
	Destinations    nullableOptional[[]string]      `json:"destinations,omitempty"`
	Amount          optional[amountInput]           `json:"amount,omitempty"`
	Date            optional[types.IsoDate]         `json:"date,omitempty"`
	Time            nullableOptional[string]        `json:"time,omitempty"`
	PostedDate      nullableOptional[types.IsoDate] `json:"postedDate,omitempty"`
	Enabled         optional[bool]                  `json:"enabled,omitempty"`
}

func (b transactionAmendBody) apply(stored types.Transaction) (types.Transaction, error) {
	out := stored
	if b.Name.Set {
		out.Name = b.Name.Value
	}
	if b.SourceAccountID.Set {
		if b.SourceAccountID.Null {
			out.SourceAccountID = nil
		} else {
			value := b.SourceAccountID.Value
			out.SourceAccountID = &value
		}
	}
	if b.Destinations.Set {
		if b.Destinations.Null {
			out.Destinations = nil
		} else {
			out.Destinations = b.Destinations.Value
		}
	}
	if b.Amount.Set {
		amount, err := b.Amount.Value.literalResolution()
		if err != nil {
			return types.Transaction{}, err
		}
		out.Amount = amount
	}
	date := dayOf(out.TransactionTime)
	if b.Date.Set {
		date = b.Date.Value
	}
	clock := timeOf(out.TransactionTime)
	if b.Time.Set {
		if b.Time.Null {
			clock = "00:00:00"
		} else {
			clock = b.Time.Value
		}
	}
	if b.Date.Set || b.Time.Set {
		transactionTime, err := instantOf(date, clock)
		if err != nil {
			return types.Transaction{}, err
		}
		out.TransactionTime = transactionTime
	}
	if b.PostedDate.Set {
		postedDate := date
		if !b.PostedDate.Null {
			postedDate = b.PostedDate.Value
		}
		postedTime, err := midnightOf(postedDate)
		if err != nil {
			return types.Transaction{}, err
		}
		out.PostedTime = postedTime
	}
	if b.Enabled.Set {
		out.Enabled = b.Enabled.Value
	}
	return out, nil
}

type transactionClaimBody struct {
	ScheduleID     string        `json:"scheduleId"`
	OccurrenceDate types.IsoDate `json:"occurrenceDate"`
}

type transactionInput struct {
	Body transactionRecordBody `json:"body"`
}

type transactionOutput struct {
	Body writeResult[types.Transaction] `json:"body"`
}

func transactionID(transaction types.Transaction) string { return transaction.ID }

func (s *handler) recordTransaction(_ context.Context, input *transactionInput) (*transactionOutput, error) {
	transaction, err := input.Body.toTransaction("")
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	if transaction.ID == "" {
		id, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, huma.Error500InternalServerError(idErr.Error())
		}
		transaction.ID = id.String()
	}
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		transaction.Destinations = displayDestinations(model, transaction.Destinations)
		model.Transactions = replaceByID(model.Transactions, transaction.ID, transactionID, transaction)
	}, func() (types.Transaction, error) {
		return s.store.CreateTransaction(transaction)
	})
	if err != nil {
		return nil, err
	}
	if saved {
		row.Source = store.SourceUser
	}
	return &transactionOutput{Body: writeResult[types.Transaction]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) storedTransaction(id string) (types.Transaction, error) {
	stored, err := s.store.LoadModel()
	if err != nil {
		return types.Transaction{}, huma.Error500InternalServerError(err.Error())
	}
	if stored != nil {
		for _, transaction := range stored.Transactions {
			if transaction.ID == id {
				return transaction, nil
			}
		}
	}
	return types.Transaction{}, huma.Error404NotFound("transaction " + id + " does not exist")
}

func (s *handler) saveTransaction(transaction types.Transaction) (*transactionOutput, error) {
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		for _, existing := range model.Transactions {
			if existing.ID == transaction.ID && !slices.Equal(existing.Destinations, transaction.Destinations) {
				transaction.Destinations = displayDestinations(model, transaction.Destinations)
				break
			}
		}
		model.Transactions = replaceByID(model.Transactions, transaction.ID, transactionID, transaction)
	}, func() (types.Transaction, error) {
		return s.store.UpdateTransaction(transaction)
	})
	if err != nil {
		return nil, err
	}
	if saved {
		row.Source = store.SourceUser
	}
	return &transactionOutput{Body: writeResult[types.Transaction]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) amendTransaction(_ context.Context, input *struct {
	ID   string               `path:"id"`
	Body transactionAmendBody `json:"body"`
}) (*transactionOutput, error) {
	existing, err := s.storedTransaction(input.ID)
	if err != nil {
		return nil, err
	}
	transaction, err := input.Body.apply(existing)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	return s.saveTransaction(transaction)
}

func (s *handler) claimOccurrence(_ context.Context, input *struct {
	ID   string               `path:"id"`
	Body transactionClaimBody `json:"body"`
}) (*transactionOutput, error) {
	existing, err := s.storedTransaction(input.ID)
	if err != nil {
		return nil, err
	}
	if input.Body.ScheduleID == "" || !domain.IsValidIsoDate(string(input.Body.OccurrenceDate)) {
		return nil, huma.Error422UnprocessableEntity("scheduleId and occurrenceDate are required")
	}
	existing.Claim = &types.TransactionClaim{
		ScheduleID:     input.Body.ScheduleID,
		OccurrenceDate: string(input.Body.OccurrenceDate),
	}
	return s.saveTransaction(existing)
}

func (s *handler) releaseOccurrence(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*transactionOutput, error) {
	existing, err := s.storedTransaction(input.ID)
	if err != nil {
		return nil, err
	}
	existing.Claim = nil
	return s.saveTransaction(existing)
}

type scheduleFromTransactionBody struct {
	ID              *string                    `json:"id,omitempty" format:"uuid"`
	Name            *string                    `json:"name,omitempty"`
	Amount          *amountInput               `json:"amount,omitempty"`
	SourceAccountID nullableOptional[string]   `json:"sourceAccountId,omitempty"`
	Destinations    nullableOptional[[]string] `json:"destinations,omitempty"`
	Frequency       types.Frequency            `json:"frequency"`
	StartDate       types.IsoDate              `json:"startDate"`
	EndDate         *types.IsoDate             `json:"endDate,omitempty"`
	AnnualIncrease  *float64                   `json:"annualIncrease,omitempty"`
	Enabled         *bool                      `json:"enabled,omitempty"`
}

type scheduleFromTransactionOutput struct {
	Body writeResult[types.Schedule] `json:"body"`
}

// startScheduleFromTransaction creates a separate recurrence schedule from a
// recorded transaction and records that transaction as the schedule's first
// occurrence. The transaction itself is unchanged.
func (s *handler) startScheduleFromTransaction(_ context.Context, input *struct {
	ID   string                      `path:"id"`
	Body scheduleFromTransactionBody `json:"body"`
}) (*scheduleFromTransactionOutput, error) {
	transaction, err := s.storedTransaction(input.ID)
	if err != nil {
		return nil, err
	}
	if transaction.Claim != nil {
		return nil, huma.Error422UnprocessableEntity(
			"transaction already records a schedule occurrence; release it before starting a schedule",
		)
	}
	if !domain.IsValidIsoDate(string(input.Body.StartDate)) {
		return nil, huma.Error422UnprocessableEntity("startDate must be a YYYY-MM-DD calendar date")
	}
	schedule := types.Schedule{
		Name:            transaction.Name,
		SourceAccountID: transaction.SourceAccountID,
		Destinations:    transaction.Destinations,
		Amount:          transaction.Amount,
		Frequency:       input.Body.Frequency,
		StartDate:       input.Body.StartDate,
		EndDate:         input.Body.EndDate,
		Enabled:         transaction.Enabled,
	}
	if input.Body.ID != nil {
		schedule.ID = *input.Body.ID
	}
	if input.Body.Name != nil {
		schedule.Name = *input.Body.Name
	}
	if input.Body.Amount != nil {
		amount, amountErr := input.Body.Amount.resolution()
		if amountErr != nil {
			return nil, huma.Error422UnprocessableEntity(amountErr.Error())
		}
		schedule.Amount = amount
	} else if input.Body.AnnualIncrease != nil {
		amount := amountInput{Value: literalValueOf(transaction.Amount), AnnualIncrease: input.Body.AnnualIncrease}
		resolved, amountErr := amount.resolution()
		if amountErr != nil {
			return nil, huma.Error422UnprocessableEntity(amountErr.Error())
		}
		schedule.Amount = resolved
	}
	if input.Body.SourceAccountID.Set {
		if input.Body.SourceAccountID.Null {
			schedule.SourceAccountID = nil
		} else {
			value := input.Body.SourceAccountID.Value
			schedule.SourceAccountID = &value
		}
	}
	if input.Body.Destinations.Set {
		if input.Body.Destinations.Null {
			schedule.Destinations = nil
		} else {
			schedule.Destinations = input.Body.Destinations.Value
		}
	}
	if input.Body.Enabled != nil {
		schedule.Enabled = *input.Body.Enabled
	}
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		maximum := -1
		for _, existing := range model.Schedules {
			if existing.Priority > maximum {
				maximum = existing.Priority
			}
		}
		schedule.Priority = maximum + 1
		model.Schedules = replaceByID(model.Schedules, schedule.ID, scheduleID, schedule)
		for index := range model.Transactions {
			if model.Transactions[index].ID != transaction.ID {
				continue
			}
			model.Transactions[index].Claim = &types.TransactionClaim{
				ScheduleID:     schedule.ID,
				OccurrenceDate: string(input.Body.StartDate),
			}
		}
	}, func() (types.Schedule, error) {
		return s.store.CreateScheduleClaimingTransaction(schedule, transaction.ID, string(input.Body.StartDate))
	})
	if err != nil {
		return nil, err
	}
	return &scheduleFromTransactionOutput{Body: writeResult[types.Schedule]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

// literalValueOf returns the literal amount of a stored descriptor when it is
// a plain numeric expression, or nil when the amount is calculated.
func literalValueOf(amount types.TransactionAmountResolution) *float64 {
	expression, _ := amount.Config["expression"].(string)
	if expression == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(expression, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func (s *handler) deleteTransaction(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*modelstate.ReorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Transactions = removeByID(model.Transactions, id, transactionID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteTransaction(id)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *handler) moveTransaction(_ context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		BeforeID string `json:"beforeId,omitempty"`
	} `json:"body"`
}) (*modelstate.ReorderOutput, error) {
	id, beforeID := input.ID, input.Body.BeforeID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Transactions = moveBeforeID(model.Transactions, id, beforeID, transactionID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveTransaction(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
