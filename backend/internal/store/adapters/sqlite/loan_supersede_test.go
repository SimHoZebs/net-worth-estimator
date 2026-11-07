package sqlite

import (
	"errors"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSupersedeRejectsBothSidesOfLoanComponentsWithoutWrites(t *testing.T) {
	for _, ids := range [][2]string{{"principal", "synced"}, {"interest", "synced"}, {"synced", "principal"}, {"synced", "interest"}} {
		t.Run(ids[0]+"-into-"+ids[1], func(t *testing.T) {
			s := openTestStore(t)
			for _, id := range []string{"cash", "synced"} {
				if _, err := s.CreateAccount(types.Account{ID: id, Name: id, Kind: "cash", Enabled: true}); err != nil {
					t.Fatal(err)
				}
			}
			bundle, err := domain.BuildLoan("principal", "interest", "charge", "payment", types.LoanTerms{Name: "Loan", Principal: 1000, ObservedAt: 1783987199, AnnualRate: 0.12, InterestFrequency: "monthly", InterestStartDate: "2026-08-13", Payment: 50, PaymentFrequency: "monthly", PaymentStartDate: "2026-08-13", FundingAccountID: "cash", Enabled: true})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.SaveLoan(bundle, true); err != nil {
				t.Fatal(err)
			}
			if _, err := s.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge", ModelAccountID: ids[1], Origin: store.LinkOriginAuto}); err != nil {
				t.Fatal(err)
			}
			before, err := s.LoadModel()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.SupersedeAccount(ids[0], ids[1], "bridge"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
				t.Fatalf("expected loan rejection, got %v", err)
			}
			after, err := s.LoadModel()
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("bank linking changed loan accounts, relationship, schedules or observations")
			}
		})
	}
}
