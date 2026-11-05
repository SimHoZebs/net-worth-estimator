package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type settleCandidateRow struct {
	PostingID           string  `json:"postingId"`
	Name                string  `json:"name"`
	Amount              float64 `json:"amount"`
	Date                string  `json:"date"`
	DayGap              int     `json:"dayGap"`
	AmountDeltaCents    int64   `json:"amountDeltaCents"`
	DescriptorChanged   bool    `json:"descriptorChanged"`
	Recommended         bool    `json:"recommended"`
	ClaimScheduleID     *string `json:"claimScheduleId,omitempty"`
	ClaimOccurrenceDate *string `json:"claimOccurrenceDate,omitempty"`
}

type settleCandidatesOutput struct {
	Body struct {
		PostingID  string               `json:"postingId"`
		Candidates []settleCandidateRow `json:"candidates"`
		Revision   string               `json:"revision"`
	} `json:"body"`
}

// listSettleCandidates answers "which posted charges could this vanished hold
// have become". The matcher runs on the server so the browser never keeps a
// second copy of the settlement policy.
func (s *handler) listSettleCandidates(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*settleCandidatesOutput, error) {
	bank, err := s.store.LoadBankPostings()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	var hold *store.BankRow
	for index := range bank {
		if bank[index].Posting.ID == input.ID {
			hold = &bank[index]
			break
		}
	}
	if hold == nil {
		return nil, huma.Error404NotFound("posting not found")
	}
	if !hold.Posting.Void || hold.Posting.Pending {
		return nil, huma.Error400BadRequest("posting is not a vanished hold")
	}
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	candidates := simplefin.SettleCandidates(*hold, bank)
	rows := make([]settleCandidateRow, 0, len(candidates))
	for index, candidate := range candidates {
		row := settleCandidateRow{
			PostingID:         candidate.Posting.ID,
			Name:              candidate.Posting.Name,
			Amount:            float64(candidate.Cents) / 100,
			Date:              simplefin.SettleCandidateDate(candidate),
			DayGap:            candidate.DayGapDays,
			AmountDeltaCents:  candidate.AmountDeltaCents,
			DescriptorChanged: candidate.DescriptorChanged,
			Recommended:       index == 0,
		}
		if candidate.Posting.Claim != nil {
			ruleID := candidate.Posting.Claim.ScheduleID
			occurrenceDate := candidate.Posting.Claim.OccurrenceDate
			row.ClaimScheduleID = &ruleID
			row.ClaimOccurrenceDate = &occurrenceDate
		}
		rows = append(rows, row)
	}
	output := &settleCandidatesOutput{}
	output.Body.PostingID = input.ID
	output.Body.Candidates = rows
	output.Body.Revision = revision
	return output, nil
}
