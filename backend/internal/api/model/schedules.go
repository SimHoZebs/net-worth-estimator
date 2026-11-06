package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Schedules are standing instructions: plans with a cadence. They are
// independent of the transactions that fulfil their occurrences.

type scheduleCreateBody struct {
	ID              *string         `json:"id,omitempty"`
	Name            string          `json:"name"`
	SourceAccountID *string         `json:"sourceAccountId,omitempty"`
	Destinations    []string        `json:"destinations,omitempty"`
	Amount          amountInput     `json:"amount"`
	Frequency       types.Frequency `json:"frequency"`
	StartDate       types.IsoDate   `json:"startDate"`
	EndDate         *types.IsoDate  `json:"endDate,omitempty"`
	AnnualCap       *float64        `json:"annualCap,omitempty"`
	Priority        *int            `json:"priority,omitempty"`
	Enabled         bool            `json:"enabled"`
}

func (b scheduleCreateBody) toSchedule(id string) (types.Schedule, error) {
	amount, err := b.Amount.resolution()
	if err != nil {
		return types.Schedule{}, err
	}
	priority := 0
	if b.Priority != nil {
		priority = *b.Priority
	}
	out := types.Schedule{
		Name: b.Name, SourceAccountID: b.SourceAccountID,
		Destinations: b.Destinations, Amount: amount, Frequency: b.Frequency,
		StartDate: b.StartDate, EndDate: b.EndDate, AnnualCap: b.AnnualCap,
		Priority: priority, Enabled: b.Enabled,
	}
	if b.ID != nil {
		out.ID = *b.ID
	}
	if id != "" {
		out.ID = id
	}
	return out, nil
}

// scheduleAmendBody states only the terms an edit changes. Absent members keep
// their stored value; a null member clears a nullable field.
type scheduleAmendBody struct {
	Name            optional[string]           `json:"name,omitempty"`
	SourceAccountID nullableOptional[string]   `json:"sourceAccountId,omitempty"`
	Destinations    nullableOptional[[]string] `json:"destinations,omitempty"`
	Amount          optional[amountInput]      `json:"amount,omitempty"`
	AnnualCap       nullableOptional[float64]  `json:"annualCap,omitempty"`
	Priority        optional[int]              `json:"priority,omitempty"`
	Enabled         optional[bool]             `json:"enabled,omitempty"`
}

func (b scheduleAmendBody) apply(stored types.Schedule) (types.Schedule, error) {
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
		amount, err := b.Amount.Value.resolution()
		if err != nil {
			return types.Schedule{}, err
		}
		out.Amount = amount
	}
	if b.AnnualCap.Set {
		if b.AnnualCap.Null {
			out.AnnualCap = nil
		} else {
			value := b.AnnualCap.Value
			out.AnnualCap = &value
		}
	}
	if b.Priority.Set {
		out.Priority = b.Priority.Value
	}
	if b.Enabled.Set {
		out.Enabled = b.Enabled.Value
	}
	return out, nil
}

type scheduleRescheduleBody struct {
	Frequency optional[types.Frequency]       `json:"frequency,omitempty"`
	StartDate optional[types.IsoDate]         `json:"startDate,omitempty"`
	EndDate   nullableOptional[types.IsoDate] `json:"endDate,omitempty"`
}

func (b scheduleRescheduleBody) apply(stored types.Schedule) types.Schedule {
	out := stored
	if b.Frequency.Set {
		out.Frequency = b.Frequency.Value
	}
	if b.StartDate.Set {
		out.StartDate = b.StartDate.Value
	}
	if b.EndDate.Set {
		if b.EndDate.Null {
			out.EndDate = nil
		} else {
			value := b.EndDate.Value
			out.EndDate = &value
		}
	}
	return out
}

type scheduleInput struct {
	Body scheduleCreateBody `json:"body"`
}

type scheduleOutput struct {
	Body writeResult[types.Schedule] `json:"body"`
}

func scheduleID(schedule types.Schedule) string { return schedule.ID }

func (s *handler) storedSchedule(id string) (types.Schedule, error) {
	stored, err := s.store.LoadModel()
	if err != nil {
		return types.Schedule{}, huma.Error500InternalServerError(err.Error())
	}
	if stored != nil {
		for _, schedule := range stored.Schedules {
			if schedule.ID == id {
				return schedule, nil
			}
		}
	}
	return types.Schedule{}, huma.Error404NotFound("schedule " + id + " does not exist")
}

func (s *handler) saveSchedule(schedule types.Schedule) (*scheduleOutput, error) {
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Schedules = replaceByID(model.Schedules, schedule.ID, scheduleID, schedule)
	}, func() (types.Schedule, error) {
		return s.store.UpdateSchedule(schedule)
	})
	if err != nil {
		return nil, err
	}
	return &scheduleOutput{Body: writeResult[types.Schedule]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) createSchedule(_ context.Context, input *scheduleInput) (*scheduleOutput, error) {
	schedule, err := input.Body.toSchedule("")
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	if schedule.ID == "" {
		id, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, huma.Error500InternalServerError(idErr.Error())
		}
		schedule.ID = id.String()
	}
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		if input.Body.Priority == nil {
			maximum := -1
			for _, existing := range model.Schedules {
				if existing.Priority > maximum {
					maximum = existing.Priority
				}
			}
			schedule.Priority = maximum + 1
		}
		model.Schedules = replaceByID(model.Schedules, schedule.ID, scheduleID, schedule)
	}, func() (types.Schedule, error) {
		return s.store.CreateSchedule(schedule)
	})
	if err != nil {
		return nil, err
	}
	return &scheduleOutput{Body: writeResult[types.Schedule]{Result: row, Issues: issues, Saved: saved, Revision: revision}}, nil
}

func (s *handler) amendSchedule(_ context.Context, input *struct {
	ID   string            `path:"id"`
	Body scheduleAmendBody `json:"body"`
}) (*scheduleOutput, error) {
	existing, err := s.storedSchedule(input.ID)
	if err != nil {
		return nil, err
	}
	schedule, err := input.Body.apply(existing)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(err.Error())
	}
	return s.saveSchedule(schedule)
}

func (s *handler) rescheduleSchedule(_ context.Context, input *struct {
	ID   string                 `path:"id"`
	Body scheduleRescheduleBody `json:"body"`
}) (*scheduleOutput, error) {
	existing, err := s.storedSchedule(input.ID)
	if err != nil {
		return nil, err
	}
	next := input.Body.apply(existing)
	if !domain.IsValidIsoDate(string(next.StartDate)) {
		return nil, huma.Error422UnprocessableEntity("startDate must be a YYYY-MM-DD calendar date")
	}
	return s.saveSchedule(next)
}

func (s *handler) deleteSchedule(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*modelstate.ReorderOutput, error) {
	id := input.ID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Schedules = removeByID(model.Schedules, id, scheduleID)
		for index := range model.Transactions {
			if model.Transactions[index].Claim != nil &&
				model.Transactions[index].Claim.ScheduleID == id {
				model.Transactions[index].Claim = nil
			}
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteSchedule(id)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *handler) moveSchedule(_ context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		BeforeID string `json:"beforeId,omitempty"`
	} `json:"body"`
}) (*modelstate.ReorderOutput, error) {
	id, beforeID := input.ID, input.Body.BeforeID
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Schedules = moveBeforeID(model.Schedules, id, beforeID, scheduleID)
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveSchedule(id, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

type scheduleEndBody struct {
	ID              *string                    `json:"id,omitempty"`
	Date            types.IsoDate              `json:"date"`
	Time            *string                    `json:"time,omitempty"`
	PostedDate      *types.IsoDate             `json:"postedDate,omitempty"`
	Amount          *amountInput               `json:"amount,omitempty"`
	SourceAccountID nullableOptional[string]   `json:"sourceAccountId,omitempty"`
	Destinations    nullableOptional[[]string] `json:"destinations,omitempty"`
	Enabled         *bool                      `json:"enabled,omitempty"`
}

type scheduleEndOutput struct {
	Body struct {
		Result          types.Transaction            `json:"value"`
		EndedScheduleID string                       `json:"endedScheduleId"`
		Issues          []types.ModelValidationIssue `json:"issues"`
		Saved           bool                         `json:"saved"`
		Revision        string                       `json:"revision"`
	} `json:"body"`
}

// endScheduleWithTransaction records the one-time transaction that actually
// happened and removes the schedule in one transaction. The transaction is a
// new fact; the schedule never becomes one.
func (s *handler) endScheduleWithTransaction(_ context.Context, input *struct {
	ID   string          `path:"id"`
	Body scheduleEndBody `json:"body"`
}) (*scheduleEndOutput, error) {
	schedule, err := s.storedSchedule(input.ID)
	if err != nil {
		return nil, err
	}
	transaction := types.Transaction{
		Name:            schedule.Name,
		SourceAccountID: schedule.SourceAccountID,
		Destinations:    schedule.Destinations,
		Amount:          schedule.Amount,
		Enabled:         schedule.Enabled,
	}
	if input.Body.ID != nil {
		transaction.ID = *input.Body.ID
	}
	if transaction.ID == "" {
		id, idErr := uuid.NewV7()
		if idErr != nil {
			return nil, huma.Error500InternalServerError(idErr.Error())
		}
		transaction.ID = id.String()
	}
	transactionTime, timeErr := instantOf(input.Body.Date, derefString(input.Body.Time))
	if timeErr != nil {
		return nil, huma.Error422UnprocessableEntity(timeErr.Error())
	}
	postedDate := input.Body.Date
	if input.Body.PostedDate != nil {
		postedDate = *input.Body.PostedDate
	}
	postedTime, postedErr := midnightOf(postedDate)
	if postedErr != nil {
		return nil, huma.Error422UnprocessableEntity(postedErr.Error())
	}
	transaction.TransactionTime = transactionTime
	transaction.PostedTime = postedTime
	if input.Body.Amount != nil {
		amount, amountErr := input.Body.Amount.literalResolution()
		if amountErr != nil {
			return nil, huma.Error422UnprocessableEntity(amountErr.Error())
		}
		transaction.Amount = amount
	}
	if input.Body.SourceAccountID.Set {
		if input.Body.SourceAccountID.Null {
			transaction.SourceAccountID = nil
		} else {
			value := input.Body.SourceAccountID.Value
			transaction.SourceAccountID = &value
		}
	}
	if input.Body.Destinations.Set {
		if input.Body.Destinations.Null {
			transaction.Destinations = nil
		} else {
			transaction.Destinations = input.Body.Destinations.Value
		}
	}
	if input.Body.Enabled != nil {
		transaction.Enabled = *input.Body.Enabled
	}
	row, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Schedules = removeByID(model.Schedules, input.ID, scheduleID)
		for index := range model.Transactions {
			if model.Transactions[index].Claim != nil &&
				model.Transactions[index].Claim.ScheduleID == input.ID {
				model.Transactions[index].Claim = nil
			}
		}
		model.Transactions = replaceByID(model.Transactions, transaction.ID, transactionID, transaction)
	}, func() (types.Transaction, error) {
		return s.store.DeleteScheduleCreatingTransaction(input.ID, transaction)
	})
	if err != nil {
		return nil, err
	}
	output := &scheduleEndOutput{}
	output.Body.Result = row
	output.Body.EndedScheduleID = input.ID
	output.Body.Issues = issues
	output.Body.Saved = saved
	output.Body.Revision = revision
	return output, nil
}
