package simplefin

import (
	"math"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// settleMatchWindowSeconds bounds pending-to-settled matching: charges
// usually finalize within days, and a wider window risks joining two
// distinct same-merchant charges.
const settleMatchWindowSeconds = 7 * 24 * 3600

func postingAmountCents(posting types.Posting) (int64, bool) {
	if posting.Amount.Resolver != "expression" {
		return 0, false
	}
	raw, ok := posting.Amount.Config["expression"].(string)
	if !ok {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return int64(math.Round(value * 100)), true
}

// rowOutflow reports whether a bank posting moves money out of its mirror
// account. Bank rows never carry both sides, so the source leg alone
// distinguishes an outflow authorization from an inflow one.
func rowOutflow(posting types.Posting) bool {
	return posting.SourceAccountID != nil
}

// settleJoinKeys verifies the non-amount join between a stale bank row and
// a settled candidate: same mirror account, same direction, parseable
// amounts, post within a week of the authorization, and overlapping names.
// It returns both amounts in cents for the caller's amount comparison.
func settleJoinKeys(stale types.Posting, candidate store.SyncPosting) (staleCents, candidateCents int64, ok bool) {
	staleAccount, ok := rowAccount(stale)
	if !ok {
		return 0, 0, false
	}
	candidateAccount, ok := rowAccount(candidate.Posting)
	if !ok || staleAccount != candidateAccount {
		return 0, 0, false
	}
	if rowOutflow(stale) != rowOutflow(candidate.Posting) {
		return 0, 0, false
	}
	staleCents, ok = postingAmountCents(stale)
	if !ok {
		return 0, 0, false
	}
	candidateCents, ok = postingAmountCents(candidate.Posting)
	if !ok || candidateCents <= 0 {
		return 0, 0, false
	}
	gap := candidate.TransactionTime - stale.TransactionTime
	if gap < -settleMatchWindowSeconds || gap > settleMatchWindowSeconds {
		return 0, 0, false
	}
	a, b := strings.ToUpper(strings.TrimSpace(candidate.Name)), strings.ToUpper(strings.TrimSpace(stale.Name))
	if !strings.Contains(a, b) && !strings.Contains(b, a) {
		return 0, 0, false
	}
	return staleCents, candidateCents, true
}

func settleMatch(stale types.Posting, candidate store.SyncPosting) bool {
	staleCents, candidateCents, ok := settleJoinKeys(stale, candidate)
	return ok && staleCents == candidateCents
}

// settleTipBounds bounds a posted total against its authorization: tips and
// final-amount adjustments move a charge up or down by a bounded fraction,
// capped absolutely so a small auth never joins a large unrelated charge.
// Zero-amount auths (card checks) never join: they vanish on their own.
func settleTipBounds(staleCents int64) (minCents, maxCents int64, ok bool) {
	if staleCents <= 0 {
		return 0, 0, false
	}
	tol := staleCents / 4
	if tol < 300 {
		tol = 300
	}
	if tol > 5000 {
		tol = 5000
	}
	return staleCents - tol, staleCents + tol, true
}

// settleMatchTolerant extends the exact join with tip-bounded amounts: a
// restaurant auth posts higher with the tip, an Instacart final posts near
// its estimate. Exact matches always qualify. Near matches still require a
// unique candidate, enforced by the caller's ambiguity guard.
func settleMatchTolerant(stale types.Posting, candidate store.SyncPosting) bool {
	staleCents, candidateCents, ok := settleJoinKeys(stale, candidate)
	if !ok {
		return false
	}
	if staleCents == candidateCents {
		return true
	}
	minCents, maxCents, ok := settleTipBounds(staleCents)
	return ok && candidateCents >= minCents && candidateCents <= maxCents
}

// rowAccount returns the model account a bank posting touches.
func rowAccount(posting types.Posting) (string, bool) {
	if posting.SourceAccountID != nil {
		return *posting.SourceAccountID, true
	}
	if len(posting.Destinations) > 0 {
		return posting.Destinations[0], true
	}
	return "", false
}

func bankKey(provider, account, transaction string) store.BankKey {
	return store.BankKey{Provider: provider, AccountID: account, TransactionID: transaction}
}

func candidateKey(item store.SyncPosting) store.BankKey {
	// The provider identity is SimpleFIN knowledge: pending authorizations
	// and posted charges from this bridge share one key namespace, which is
	// what lets a posted charge convert the pending row it settles.
	return bankKey(store.SourceSimpleFIN, item.ProviderAccountID, item.TransactionID)
}

// Reconcile translates one mapped snapshot plus loaded bank rows into store
// directives. It owns every SimpleFIN lifecycle decision: pending items
// upsert by key, vanished pending or void rows convert on a unique
// tip-bounded posted match or void otherwise, and unmatched posted charges
// insert. Only this provider's rows and keys participate; other providers'
// bank rows are invisible to it. Covered limits stale handling to resolved
// accounts so unlinked accounts' rows are never touched. A candidate whose
// key is already recorded is already imported and never reprocesses, so
// repeat feeds are stable no-ops. Tip-bounded matching applies only to
// pending lifecycle transitions; the settled-to-settled duplicate check
// stays exact so near-amount repeats never suppress a genuine second charge.
func Reconcile(pending, settled []store.SyncPosting, bank []store.BankRow, covered map[string]bool) []store.BankDirective {
	byKey := map[store.BankKey]string{}
	byID := map[string]store.BankRow{}
	for _, row := range bank {
		if row.Posting.Source != store.SourceSimpleFIN {
			continue
		}
		byID[row.Posting.ID] = row
		for _, key := range row.Keys {
			if key.Provider != store.SourceSimpleFIN {
				continue
			}
			byKey[key] = row.Posting.ID
		}
	}
	var directives []store.BankDirective
	seen := map[string]bool{}
	// Pending upserts are intentionally ungated by coverage: the mapper
	// emits them only for resolved accounts.
	for _, item := range pending {
		directives = append(directives, store.BankDirective{
			Upsert: &store.BankUpsert{Posting: item.Posting, Keys: []store.BankKey{candidateKey(item)}},
		})
		if id, ok := byKey[candidateKey(item)]; ok {
			seen[id] = true
		}
	}
	type staleRow struct {
		id      string
		pending bool
	}
	var stale []staleRow
	for _, row := range bank {
		if seen[row.Posting.ID] {
			continue
		}
		if row.Posting.Pending || row.Posting.Void {
			stale = append(stale, staleRow{id: row.Posting.ID, pending: row.Posting.Pending})
		}
	}
	used := map[int]bool{}
	recorded := func(item store.SyncPosting) bool {
		_, ok := byKey[candidateKey(item)]
		return ok
	}
	coveredAccount := func(item store.SyncPosting) bool {
		account, ok := rowAccount(item.Posting)
		return ok && covered[account]
	}
	for _, entry := range stale {
		row := byID[entry.id]
		if account, ok := rowAccount(row.Posting); !ok || !covered[account] {
			continue
		}
		match := -1
		for i, candidate := range settled {
			if used[i] || recorded(candidate) || !settleMatchTolerant(row.Posting, candidate) {
				continue
			}
			if match != -1 {
				match = -2
				break
			}
			match = i
		}
		if match >= 0 {
			candidate := settled[match]
			used[match] = true
			directives = append(directives, store.BankDirective{
				Convert: &store.BankConvert{
					ID:      entry.id,
					Posting: candidate.Posting,
					AddKeys: []store.BankKey{candidateKey(candidate)},
				},
			})
			continue
		}
		if entry.pending {
			directives = append(directives, store.BankDirective{Void: entry.id})
		}
	}
present:
	for i, candidate := range settled {
		if used[i] || recorded(candidate) || !coveredAccount(candidate) {
			continue
		}
		// A candidate matching live pending values defers: the pending
		// row converts when it vanishes instead of duplicating now.
		// Tip-bounded amounts defer like exact ones so a tipped total
		// waits for its authorization instead of inserting beside it.
		deferred := false
		for _, item := range pending {
			if settleMatchTolerant(item.Posting, candidate) {
				deferred = true
				break
			}
		}
		if !deferred {
			for id := range seen {
				if row := byID[id]; row.Posting.Pending && settleMatchTolerant(row.Posting, candidate) {
					deferred = true
					break
				}
			}
		}
		if deferred {
			continue
		}
		// A candidate matching an existing settled bank row is already
		// imported. The check stays exact: a near-amount repeat at the
		// same merchant is a genuine second charge, not a repost.
		// Void rows never suppress: the void record stays and the
		// posted charge inserts as its own row.
		for _, row := range bank {
			if row.Posting.Source != store.SourceSimpleFIN {
				continue
			}
			if row.Posting.Pending || row.Posting.Void {
				continue
			}
			if settleMatch(row.Posting, candidate) {
				continue present
			}
		}
		directives = append(directives, store.BankDirective{
			Upsert: &store.BankUpsert{Posting: candidate.Posting, Keys: []store.BankKey{candidateKey(candidate)}},
		})
	}
	// Evidence refreshes also apply to known settled keys, independently of the
	// posting directives. This preserves metadata without overwriting owner edits.
	for _, items := range [][]store.SyncPosting{pending, settled} {
		for _, item := range items {
			if item.Facts != nil {
				directives = append(directives, store.BankDirective{Observe: &store.BankObservation{Keys: []store.BankKey{candidateKey(item)}, Facts: *item.Facts}})
			}
		}
	}
	return directives
}
