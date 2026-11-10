package simplefin

import (
	"context"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/ingest"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// bridgeAdapter is the SimpleFIN TransactionProvider adapter. Native fetch
// shapes stay in this package; the ingest orchestrator owns provisioning,
// apply, and dirty marking for every provider.
type bridgeAdapter struct {
	runner *Runner
}

var _ ingest.Adapter = bridgeAdapter{}

func (a bridgeAdapter) Key() string {
	return store.ProviderSimpleFIN
}

// Notices reports non-fatal range notices and scoped errors. Fatal general
// errors already failed the fetch.
func (a bridgeAdapter) Notices(native any) []ingest.Notice {
	set, ok := native.(*AccountSet)
	if !ok || set == nil {
		return nil
	}
	notices := make([]ingest.Notice, 0, len(set.ErrList))
	for _, entry := range set.ErrList {
		if entry.isRateLimit() {
			continue
		}
		scope := "general"
		switch entry.class() {
		case "con":
			scope = "connection"
		case "act":
			scope = "account"
		}
		notices = append(notices, ingest.Notice{
			Code:         entry.Code,
			Message:      sanitizeMessage(entry.Msg),
			Scope:        scope,
			ConnectionID: entry.ConnID,
			AccountID:    entry.AccountID,
		})
	}
	return notices
}

func (a bridgeAdapter) Fetch(ctx context.Context, start, end time.Time) (any, error) {
	return a.runner.fetchWithRetry(ctx, start, end)
}

func (a bridgeAdapter) Provisions(native any) []store.SyncProvision {
	set, ok := native.(*AccountSet)
	if !ok || set == nil {
		return nil
	}
	exclusions := set.Exclusions()
	// One connection is one login link to an institution. Map each
	// connection to the bank organization name the bridge reported,
	// falling back to the connection login name when no organization
	// name is present.
	institutions := make(map[string]string, len(set.Connections))
	for _, connection := range set.Connections {
		name := strings.TrimSpace(connection.OrgName)
		if name == "" {
			name = strings.TrimSpace(connection.Name)
		}
		if name == "" || connection.ConnID == "" {
			continue
		}
		if _, seen := institutions[connection.ConnID]; !seen {
			institutions[connection.ConnID] = name
		}
	}
	provisions := make([]store.SyncProvision, 0, len(set.Accounts))
	for _, account := range set.Accounts {
		if exclusions.Excluded(account.ConnID, account.ID) {
			continue
		}
		provisions = append(provisions, store.SyncProvision{
			BridgeID:    AccountKey(account.ConnID, account.ID),
			Name:        account.Name,
			Institution: institutions[account.ConnID],
			Currency:    account.Currency,
		})
	}
	return provisions
}

func (a bridgeAdapter) WithoutStale(native any, stale []string) any {
	set, ok := native.(*AccountSet)
	if !ok || set == nil || len(stale) == 0 {
		return native
	}
	dropped := make(map[string]struct{}, len(stale))
	for _, id := range stale {
		dropped[id] = struct{}{}
	}
	kept := make([]Account, 0, len(set.Accounts))
	for _, account := range set.Accounts {
		if _, ok := dropped[AccountKey(account.ConnID, account.ID)]; !ok {
			kept = append(kept, account)
		}
	}
	filtered := *set
	filtered.Accounts = kept
	return &filtered
}

func (a bridgeAdapter) Translate(ctx context.Context, st store.Store, native any, resolved map[string]string, now time.Time) ([]store.SyncCheckpoint, []store.BankDirective, map[string]int, error) {
	set, ok := native.(*AccountSet)
	if !ok || set == nil {
		return nil, nil, map[string]int{}, nil
	}
	translation, err := Translate(set, resolved, now)
	if err != nil {
		return nil, nil, nil, err
	}
	// Re-resolve every checkpoint against post-provisioning truth. A
	// stale link (model account deleted) resolves to nothing and its
	// checkpoint is dropped: counted, never written.
	kept := translation.Checkpoints[:0]
	for _, checkpoint := range translation.Checkpoints {
		modelID, ok := resolved[checkpoint.BridgeID]
		if !ok {
			continue
		}
		checkpoint.AccountID = modelID
		kept = append(kept, checkpoint)
	}
	translation.Checkpoints = kept
	checkpoints := make([]store.SyncCheckpoint, 0, len(translation.Checkpoints))
	for _, checkpoint := range translation.Checkpoints {
		checkpoints = append(checkpoints, store.SyncCheckpoint{
			AccountID:        checkpoint.AccountID,
			Balance:          checkpoint.Balance,
			AvailableBalance: checkpoint.AvailableBalance,
			Source:           store.SourceBankSync,
			Provider:         store.ProviderSimpleFIN,
			ObservedAt:       checkpoint.ObservedAt,
		})
	}
	bank, err := st.LoadBankTransactions()
	if err != nil {
		return nil, nil, nil, err
	}
	covered := make(map[string]bool, len(resolved))
	for _, modelID := range resolved {
		covered[modelID] = true
	}
	directives := Reconcile(translation.Pending, translation.Settled, bank, covered)
	skipped := map[string]int{}
	for reason, count := range translation.Skipped {
		skipped[string(reason)] = count
	}
	return checkpoints, directives, skipped, nil
}
