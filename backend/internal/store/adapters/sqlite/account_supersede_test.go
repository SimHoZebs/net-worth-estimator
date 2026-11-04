package sqlite

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func supersedeStringPtr(value string) *string { return &value }
func supersedeFloatPtr(value float64) *float64 {
	return &value
}

func TestSupersedeAccountMovesProfileAndConfiguration(t *testing.T) {
	d := openSharingTestDB(t)
	alice, scoped := policyMember(t, d, "alice", "manual", "synced", "savings")
	for _, id := range []string{"checking", "synced", "savings"} {
		if _, err := scoped.UpdateAccount(types.Account{ID: id, Name: id, Kind: types.AccountKindCash, Enabled: true}); err != nil {
			t.Fatalf("profile account %s: %v", id, err)
		}
	}
	if _, err := scoped.UpdateAccount(types.Account{
		ID: "manual", Name: "Joint Checking", Kind: types.AccountKindCash,
		MinBalance: supersedeFloatPtr(100), MaxBalance: supersedeFloatPtr(5000),
		Color: supersedeStringPtr("#123456"), Enabled: true,
	}); err != nil {
		t.Fatalf("profile manual account: %v", err)
	}
	if _, err := scoped.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto,
	}); err != nil {
		t.Fatalf("seed link: %v", err)
	}
	if _, err := scoped.ApplySync([]store.SyncCheckpoint{{
		AccountID: "synced", Balance: 700, Source: store.SourceBankSync,
		Provider: store.ProviderSimpleFIN, ObservedAt: policyNoon("2026-06-01"),
	}}, nil); err != nil {
		t.Fatalf("seed bank checkpoint: %v", err)
	}
	policyRow(t, scoped, sharingPostingA, "manual", nil, "2026-06-02")
	if _, err := scoped.SaveCheckpoint(types.Checkpoint{
		AccountID: "manual", Balance: 500, ObservedAt: policyNoon("2026-06-01"),
	}); err != nil {
		t.Fatalf("seed manual checkpoint: %v", err)
	}
	if _, err := scoped.CreateRule(types.RecurrenceRule{
		ID: "01900000-0000-7000-8000-0000000000b4", Name: "Rent", SourceAccountID: supersedeStringPtr("manual"),
		Destinations: []string{"savings"},
		Amount: types.PostingAmountResolution{
			Resolver: "expression", Config: map[string]any{"expression": "manual"},
			Inputs: map[string]types.AmountInputBinding{
				"manual": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "manual"}},
			},
		},
		Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", Enabled: true,
	}); err != nil {
		t.Fatalf("seed rule: %v", err)
	}
	if _, err := scoped.CreatePosting(types.Posting{
		ID: "01900000-0000-7000-8000-0000000000b5", Name: "Savings sweep",
		SourceAccountID: supersedeStringPtr("savings"),
		Amount: types.PostingAmountResolution{
			Resolver: "expression", Config: map[string]any{"expression": "manual"},
			Inputs: map[string]types.AmountInputBinding{
				"manual": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "manual"}},
			},
		},
		PostedTime: 1782950400, TransactionTime: 1782950400, Enabled: true,
	}); err != nil {
		t.Fatalf("seed surviving posting: %v", err)
	}
	if _, err := scoped.CreatePlannedPurchase(types.PlannedPurchase{
		ID: "01900000-0000-7000-8000-0000000000b2", Name: "Car", FundingAccountID: supersedeStringPtr("manual"),
		Cost: 1000, EarliestDate: "2026-07-01", Enabled: true,
	}); err != nil {
		t.Fatalf("seed purchase: %v", err)
	}
	if _, err := scoped.CreateEvaluation(store.EvaluationUpdate{
		Type: types.EvaluationTypeAccountBalance, InstanceID: "01900000-0000-7000-8000-0000000000b3", Name: "Savings goal", Enabled: true,
		Config: map[string]any{"accountId": "manual", "target": 1000},
	}); err != nil {
		t.Fatalf("seed evaluation: %v", err)
	}
	if err := scoped.SetSafeSpendingSettings(types.SafeSpendingSettings{
		StatementDay: 1, Reserve: 0,
		AccountIDs:         []string{"manual"},
		SpendingAccountIDs: []string{"manual"},
		IncomeAccountIDs:   []string{"manual"},
		IncomeRuleIDs:      []string{"01900000-0000-7000-8000-0000000000b4"},
		TransactionIDs:     []string{sharingPostingA},
		StatementDaySet:    true,
	}); err != nil {
		t.Fatalf("seed safe spending: %v", err)
	}
	if _, err := scoped.SetSyncCards([]string{"manual", "savings"}); err != nil {
		t.Fatalf("seed sync cards: %v", err)
	}
	group := sharingGroup(t, d, "alice", "Club")
	first, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"manual", "savings"}, StartDate: "2026-01-01",
	})
	if err != nil {
		t.Fatalf("seed sharing policy: %v", err)
	}

	result, err := scoped.SupersedeAccount("manual", "synced", "bridge-1")
	if err != nil {
		t.Fatalf("supersede: %v", err)
	}
	if !result.Persisted {
		t.Fatalf("supersede did not persist: %+v", result.Issues)
	}
	for _, issue := range result.Issues {
		if issue.Severity == types.SeverityError {
			t.Fatalf("supersede persisted with error issue: %+v", issue)
		}
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	var synced, manual *types.Account
	for index := range model.Accounts {
		switch model.Accounts[index].ID {
		case "synced":
			synced = &model.Accounts[index]
		case "manual":
			manual = &model.Accounts[index]
		}
	}
	if manual != nil {
		t.Fatal("manual account survived the supersede")
	}
	if synced == nil {
		t.Fatal("synced account disappeared")
	}
	if synced.Name != "Joint Checking" || synced.Color == nil || *synced.Color != "#123456" ||
		synced.Kind != types.AccountKindCash || synced.MinBalance == nil || *synced.MinBalance != 100 ||
		synced.MaxBalance == nil || *synced.MaxBalance != 5000 {
		t.Fatalf("synced account did not inherit manual profile: %+v", synced)
	}
	if len(model.Accounts) != 3 || model.Accounts[0].ID != "checking" || model.Accounts[1].ID != "synced" || model.Accounts[2].ID != "savings" {
		t.Fatalf("account order = %+v, want checking, synced, savings", model.Accounts)
	}
	for _, posting := range model.Postings {
		if posting.SourceAccountID != nil && *posting.SourceAccountID == "manual" {
			t.Fatalf("manual posting survived: %+v", posting)
		}
	}
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.AccountID == "manual" {
			t.Fatalf("manual checkpoint survived: %+v", checkpoint)
		}
	}
	if len(model.Checkpoints) != 1 || model.Checkpoints[0].AccountID != "synced" || model.Checkpoints[0].Source != store.SourceBankSync {
		t.Fatalf("synced bank checkpoint changed: %+v", model.Checkpoints)
	}
	if len(model.RecurrenceRules) != 1 || model.RecurrenceRules[0].SourceAccountID == nil ||
		*model.RecurrenceRules[0].SourceAccountID != "synced" || !supersedeContains(model.RecurrenceRules[0].Destinations, "savings") {
		t.Fatalf("rule route did not move: %+v", model.RecurrenceRules)
	}
	if got := model.RecurrenceRules[0].Amount.Inputs["manual"].Arguments["id"]; got != "synced" {
		t.Fatalf("rule amount reference = %v, want synced", got)
	}
	var sweep *types.Posting
	for index := range model.Postings {
		if model.Postings[index].ID == "01900000-0000-7000-8000-0000000000b5" {
			sweep = &model.Postings[index]
		}
	}
	if sweep == nil {
		t.Fatal("surviving posting disappeared")
	}
	if got := sweep.Amount.Inputs["manual"].Arguments["id"]; got != "synced" {
		t.Fatalf("posting amount reference = %v, want synced", got)
	}
	if len(model.PlannedPurchases) != 1 || model.PlannedPurchases[0].FundingAccountID == nil ||
		*model.PlannedPurchases[0].FundingAccountID != "synced" {
		t.Fatalf("planned purchase funding did not move: %+v", model.PlannedPurchases)
	}
	if len(model.Evaluations.AccountBalance) != 1 {
		t.Fatalf("account evaluation disappeared: %+v", model.Evaluations.AccountBalance)
	}
	config, ok := model.Evaluations.AccountBalance[0].Config.(map[string]any)
	if !ok || config["accountId"] != "synced" {
		t.Fatalf("evaluation account reference = %+v, want synced", model.Evaluations.AccountBalance[0].Config)
	}
	settings, err := scoped.GetSafeSpendingSettings()
	if err != nil || settings == nil {
		t.Fatalf("safe spending settings = %+v, err %v", settings, err)
	}
	if len(settings.AccountIDs) != 1 || settings.AccountIDs[0] != "synced" ||
		len(settings.SpendingAccountIDs) != 1 || settings.SpendingAccountIDs[0] != "synced" ||
		len(settings.IncomeAccountIDs) != 1 || settings.IncomeAccountIDs[0] != "synced" ||
		len(settings.TransactionIDs) != 0 || len(settings.IncomeRuleIDs) != 1 || settings.IncomeRuleIDs[0] != "01900000-0000-7000-8000-0000000000b4" {
		t.Fatalf("safe spending settings did not move: %+v", settings)
	}
	cards, err := scoped.GetSyncCards()
	if err != nil || len(cards) != 2 || cards[0] != "synced" || cards[1] != "savings" {
		t.Fatalf("sync cards did not move: %v, err %v", cards, err)
	}
	policy, err := d.GetSharingPolicy(alice, group)
	if err != nil {
		t.Fatalf("get sharing policy: %v", err)
	}
	if len(policy.AccountIDs) != 2 || policy.AccountIDs[0] != "synced" || policy.AccountIDs[1] != "savings" {
		t.Fatalf("sharing policy accounts = %v, want [synced savings]", policy.AccountIDs)
	}
	if policy.Version != first.Version+1 {
		t.Fatalf("sharing policy version = %d, want %d", policy.Version, first.Version+1)
	}
	links, err := scoped.ListAccountLinks()
	if err != nil || len(links) != 1 || links[0].BridgeAccountID != "bridge-1" || links[0].ModelAccountID != "synced" {
		t.Fatalf("bridge link changed: %+v, err %v", links, err)
	}
}

func TestSupersedeAccountMovesDebtProfileAndPaymentTerms(t *testing.T) {
	d := openSharingTestDB(t)
	_, scoped := policyMember(t, d, "alice", "manual", "synced")
	if _, err := scoped.UpdateAccount(types.Account{
		ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.UpdateAccount(types.Account{
		ID: "manual", Name: "Visa", Kind: types.AccountKindDebt, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.UpdateAccount(types.Account{
		ID: "synced", Name: "Bank card", Kind: types.AccountKindCash, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.SaveAccountLink(store.AccountLink{
		BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.SavePaymentTerms(types.PaymentTerms{
		AccountID: "manual", MinimumFixed: 25, DueDay: 15,
	}); err != nil {
		t.Fatalf("seed payment terms: %v", err)
	}
	result, err := scoped.SupersedeAccount("manual", "synced", "bridge-1")
	if err != nil || !result.Persisted {
		t.Fatalf("supersede debt account = %+v, %v", result, err)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	var synced *types.Account
	for index := range model.Accounts {
		if model.Accounts[index].ID == "synced" {
			synced = &model.Accounts[index]
		}
	}
	if synced == nil || synced.Name != "Visa" || synced.Kind != types.AccountKindDebt {
		t.Fatalf("synced debt profile = %+v", synced)
	}
	if len(model.PaymentTerms) != 1 || model.PaymentTerms[0].AccountID != "synced" || model.PaymentTerms[0].MinimumFixed != 25 {
		t.Fatalf("payment terms did not move: %+v", model.PaymentTerms)
	}
}

func TestSupersedeAccountRejectsNonManualAccounts(t *testing.T) {
	t.Run("manual already has bank history", func(t *testing.T) {
		d := openSharingTestDB(t)
		_, scoped := policyMember(t, d, "alice", "manual", "synced")
		if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto}); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.ApplySync([]store.SyncCheckpoint{{
			AccountID: "manual", Balance: 1, Source: store.SourceBankSync,
			Provider: store.ProviderSimpleFIN, ObservedAt: policyNoon("2026-06-01"),
		}}, nil); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.SupersedeAccount("manual", "synced", "bridge-1"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
			t.Fatalf("supersede synced manual = %v, want invalid", err)
		}
	})
	t.Run("manual is linked to a bridge", func(t *testing.T) {
		d := openSharingTestDB(t)
		_, scoped := policyMember(t, d, "alice", "manual", "synced")
		if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "manual", Origin: store.LinkOriginManual}); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.SupersedeAccount("manual", "synced", "bridge-1"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
			t.Fatalf("supersede linked manual = %v, want invalid", err)
		}
	})
	t.Run("synced target has no link", func(t *testing.T) {
		d := openSharingTestDB(t)
		_, scoped := policyMember(t, d, "alice", "manual", "synced")
		if _, err := scoped.SupersedeAccount("manual", "synced", "bridge-1"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
			t.Fatalf("supersede unlinked synced = %v, want invalid", err)
		}
	})
	t.Run("expected bridge link changed", func(t *testing.T) {
		d := openSharingTestDB(t)
		_, scoped := policyMember(t, d, "alice", "manual", "synced")
		if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto}); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.SupersedeAccount("manual", "synced", "bridge-2"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
			t.Fatalf("supersede with changed bridge = %v, want invalid", err)
		}
	})
	t.Run("manual has empty-source checkpoint", func(t *testing.T) {
		d := openSharingTestDB(t)
		alice, scoped := policyMember(t, d, "alice", "manual", "synced")
		if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto}); err != nil {
			t.Fatal(err)
		}
		if _, err := d.SQL().Exec(`INSERT INTO checkpoints (id, position, model_account_id, balance, source, observed_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			1001, 1001, "manual", 10, "", policyNoon("2026-06-01"), alice); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.SupersedeAccount("manual", "synced", "bridge-1"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
			t.Fatalf("supersede empty-source checkpoint = %v, want invalid", err)
		}
	})
	t.Run("manual has bank posting", func(t *testing.T) {
		d := openSharingTestDB(t)
		alice, scoped := policyMember(t, d, "alice", "manual", "synced")
		if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto}); err != nil {
			t.Fatal(err)
		}
		const bankPosting = "01900000-0000-7000-8000-0000000000c2"
		if _, err := d.SQL().Exec(`INSERT INTO postings (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, user_id) VALUES (?, ?, ?, 'null', ?, ?, ?, 'banksync', 0, 0, ?)`,
			bankPosting, "Bank sweep", "manual", syncTestAmountJSON, 1782950400, 1782950400, alice); err != nil {
			t.Fatal(err)
		}
		if _, err := d.SQL().Exec(`INSERT INTO posting_sim (posting_id, position, enabled, execution_order, user_id) VALUES (?, 0, 1, 0, ?)`,
			bankPosting, alice); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.SupersedeAccount("manual", "synced", "bridge-1"); !errors.Is(err, store.ErrAccountSupersedeInvalid) {
			t.Fatalf("supersede bank posting = %v, want invalid", err)
		}
	})
}

func TestSupersedeAccountRollsBackInvalidCandidate(t *testing.T) {
	d := openSharingTestDB(t)
	_, scoped := policyMember(t, d, "alice", "manual", "synced")
	if _, err := scoped.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-1", ModelAccountID: "synced", Origin: store.LinkOriginAuto}); err != nil {
		t.Fatal(err)
	}
	// A pre-existing invalid route gives the candidate a finance error. The
	// operation must report issues and leave every stored row unchanged.
	if _, err := scoped.CreatePosting(types.Posting{
		ID: "01900000-0000-7000-8000-0000000000b1", Name: "Broken", SourceAccountID: supersedeStringPtr("synced"),
		Destinations: []string{"ghost"},
		Amount:       types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:   1782950400, TransactionTime: 1782950400, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	before, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	result, err := scoped.SupersedeAccount("manual", "synced", "bridge-1")
	if err != nil {
		t.Fatalf("supersede invalid candidate: %v", err)
	}
	if result.Persisted || !supersedeHasErrors(result.Issues) {
		t.Fatalf("invalid candidate = %+v, want persisted false with errors", result)
	}
	after, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatal("rejected supersede changed stored model")
	}
}
