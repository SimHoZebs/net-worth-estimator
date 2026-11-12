package model

import (
	"context"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *handler) deleteLoan(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct{ Body writeResult[string] }, error) {
	_, issues, saved, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		for _, a := range model.Accounts {
			if a.ID != input.ID || a.Display == nil || types.IsPassthroughDisplay(a.Display, a.ID) {
				continue
			}
			members := map[string]bool{}
			for _, c := range a.Display.Components {
				members[c.AccountID] = true
			}
			kept := []types.Account{}
			for _, member := range model.Accounts {
				if !members[member.ID] {
					kept = append(kept, member)
				}
			}
			model.Accounts = kept
			checks := []types.Checkpoint{}
			for _, c := range model.Checkpoints {
				if !members[c.AccountID] {
					checks = append(checks, c)
				}
			}
			model.Checkpoints = checks
			model.Schedules = removeByID(model.Schedules, a.Display.InterestScheduleID, scheduleID)
			model.Schedules = removeByID(model.Schedules, a.Display.PaymentScheduleID, scheduleID)
			return
		}
	}, func() (struct{}, error) { return struct{}{}, s.store.DeleteLoan(input.ID) })
	if err != nil {
		return nil, err
	}
	return &struct{ Body writeResult[string] }{Body: writeResult[string]{Result: input.ID, Issues: issues, Saved: saved, Revision: revision}}, nil
}
