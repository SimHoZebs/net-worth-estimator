package simplefin

import (
	"context"
	"log/slog"
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
	for _, account := range set.Accounts {
		transactions += len(account.Transactions)
	}
	codes := make([]string, 0, len(set.ErrList))
	for _, entry := range set.ErrList {
		codes = append(codes, entry.Code)
	}
	slog.InfoContext(ctx, "simplefin response",
		"host", host, "start", start.UTC(), "end", end.UTC(),
		"connections", len(set.Connections), "accounts", len(set.Accounts),
		"transactions", transactions, "notices", len(set.ErrList), "codes", codes)
}
