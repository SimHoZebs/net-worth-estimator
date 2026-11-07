package simplefin

import (
	"context"
	"log/slog"
	"sort"
	"time"
)

// isRangeNotice recognizes Bridge API notices verified to accompany usable
// account data. Other API errors still fail the fetch.
func (e ProtocolError) isRangeNotice() bool {
	if e.Code != "gen.api" {
		return false
	}
	switch e.Msg {
	case "Requested date range exceeds limit of 90 days and was capped.",
		"Requested date range exceeds recommended range of 45 days. In the future, this may be capped.":
		return true
	}
	return false
}

func logAccountSet(ctx context.Context, host string, start, end time.Time, set *AccountSet) {
	transactions := 0
	accountsWithExtra := 0
	extraKeys := map[string]struct{}{}
	for _, account := range set.Accounts {
		transactions += len(account.Transactions)
		if len(account.Extra) > 0 {
			accountsWithExtra++
			for key := range account.Extra {
				extraKeys[key] = struct{}{}
			}
		}
	}
	keys := make([]string, 0, len(extraKeys))
	for key := range extraKeys {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	codes := make([]string, 0, len(set.ErrList))
	for _, entry := range set.ErrList {
		codes = append(codes, entry.Code)
	}
	slog.InfoContext(ctx, "simplefin response",
		"host", host, "start", start.UTC(), "end", end.UTC(),
		"connections", len(set.Connections), "accounts", len(set.Accounts),
		"transactions", transactions, "notices", len(set.ErrList), "codes", codes,
		"accounts_with_extra", accountsWithExtra, "account_extra_keys", keys)
}
