// Automatic sharing-policy semantics (GRP-02). These pure helpers own the
// eligibility contract every consumer shares: the policy store, the
// read-time authorization check, the exposure preview, and the later
// reference index (GRP-05). Eligibility derives from the posting's current
// account associations and current transaction date; edits that move or
// re-date a row reshape visibility without touching the policy.
package store

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SharingPolicyReasonAutomatic names the policy-derived automatic reason
// in SharedPostingAccess. Manual reasons stay "manual-user"/"manual-group".
const SharingPolicyReasonAutomatic = "automatic-group"

// calendarDay is the shared YYYY-MM-DD calendar used for policy intervals.
const calendarDay = "2006-01-02"

// DefaultSharingStartDate returns the setup-day default for a policy start:
// today on the shared calendar. Callers persist the returned day as a fixed
// date; it never rolls.
func DefaultSharingStartDate() string {
	return time.Now().UTC().Format(calendarDay)
}

// parseSharingDay validates one YYYY-MM-DD calendar day. time.Parse alone
// normalizes impossible days (February 30 becomes March 2), so values must
// round-trip exactly.
func parseSharingDay(day string) (string, error) {
	parsed, err := time.Parse(calendarDay, day)
	if err != nil {
		return "", err
	}
	if parsed.Format(calendarDay) != day {
		return "", fmt.Errorf("not a calendar day: %s", day)
	}
	return day, nil
}

// NormalizeSharingPolicyInput validates editable preference values and
// returns the canonical form to persist: trimmed, deduplicated, and sorted
// account IDs plus a resolved interval. An empty start resolves to the
// setup-day default; an empty end stays open-ended.
func NormalizeSharingPolicyInput(input SharingPolicyInput) (SharingPolicyInput, error) {
	seen := map[string]bool{}
	accounts := []string{}
	for _, id := range input.AccountIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		accounts = append(accounts, id)
	}
	sort.Strings(accounts)
	out := SharingPolicyInput{Enabled: input.Enabled, AccountIDs: accounts}
	start := strings.TrimSpace(input.StartDate)
	if start == "" {
		start = DefaultSharingStartDate()
	}
	day, err := parseSharingDay(start)
	if err != nil {
		return SharingPolicyInput{}, fmt.Errorf("invalid sharing start date: %w", err)
	}
	out.StartDate = day
	end := strings.TrimSpace(input.EndDate)
	if end != "" {
		day, err := parseSharingDay(end)
		if err != nil {
			return SharingPolicyInput{}, fmt.Errorf("invalid sharing end date: %w", err)
		}
		if day < out.StartDate {
			return SharingPolicyInput{}, fmt.Errorf("invalid sharing end date: ends before it starts")
		}
		out.EndDate = day
	}
	if out.Enabled && len(accounts) == 0 {
		return SharingPolicyInput{}, fmt.Errorf("invalid sharing policy: enabling requires at least one account")
	}
	return out, nil
}

// sharingTransactionDay reports the UTC day of a posting's transaction
// time. The transaction date is the single canonical sharing date; both
// times are always present on stored rows, so no fallback applies here.
func sharingTransactionDay(posting types.Posting) string {
	return time.Unix(posting.TransactionTime, 0).UTC().Format(calendarDay)
}

// PolicyCoversPosting reports whether one posting is automatically eligible
// under one policy: the policy is enabled with selected accounts, the
// posting is not void, any currently involved account (source or any
// destination, transfers included) matches, and the current transaction
// day falls inside the interval on both ends. Pending postings qualify
// exactly like posted ones; there are no category or transfer exceptions.
func PolicyCoversPosting(policy SharingPolicy, posting types.Posting) bool {
	if !policy.Enabled || len(policy.AccountIDs) == 0 {
		return false
	}
	if posting.Void {
		return false
	}
	selected := map[string]bool{}
	for _, id := range policy.AccountIDs {
		selected[id] = true
	}
	matched := false
	if posting.SourceAccountID != nil && selected[*posting.SourceAccountID] {
		matched = true
	}
	for _, destination := range posting.Destinations {
		if selected[destination] {
			matched = true
			break
		}
	}
	if !matched {
		return false
	}
	day := sharingTransactionDay(posting)
	if day < policy.StartDate {
		return false
	}
	if policy.EndDate != "" && day > policy.EndDate {
		return false
	}
	return true
}
