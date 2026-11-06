package simplefin

import (
	"math"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// settleMatchWindowSeconds bounds settled-to-settled duplicate detection.
// Hold settlement uses the merchant profile's window instead.
const settleMatchWindowSeconds = 7 * 24 * 3600

func transactionAmountCents(transaction types.Transaction) (int64, bool) {
	if transaction.Amount.Resolver != "expression" {
		return 0, false
	}
	raw, ok := transaction.Amount.Config["expression"].(string)
	if !ok {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return int64(math.Round(value * 100)), true
}

// rowOutflow reports whether a bank transaction moves money out of its mirror
// account. Bank rows never carry both sides, so the source leg alone
// distinguishes an outflow authorization from an inflow one.
func rowOutflow(transaction types.Transaction) bool {
	return transaction.SourceAccountID != nil
}

// settleStrictJoinKeys keeps the containment rule for settled-to-settled
// deduplication. The wider merchant key is only for hold-to-posted
// settlement: two posted charges at the same chain but different store
// numbers can be genuine separate charges.
func settleStrictJoinKeys(stale types.Transaction, candidate types.Transaction) (staleCents, candidateCents int64, ok bool) {
	return settleJoinKeysWith(stale, candidate, settleMatchWindowSeconds, merchantNamesContain)
}

// settleJoinKeysWith checks the account, direction, positive amounts, window,
// and the injected name rule. It returns both amounts in cents.
func settleJoinKeysWith(stale types.Transaction, candidate types.Transaction, windowSeconds int64, namesMatch func(string, string) bool) (staleCents, candidateCents int64, ok bool) {
	staleAccount, ok := rowAccount(stale)
	if !ok {
		return 0, 0, false
	}
	candidateAccount, ok := rowAccount(candidate)
	if !ok || staleAccount != candidateAccount {
		return 0, 0, false
	}
	if rowOutflow(stale) != rowOutflow(candidate) {
		return 0, 0, false
	}
	staleCents, ok = transactionAmountCents(stale)
	if !ok || staleCents <= 0 {
		return 0, 0, false
	}
	candidateCents, ok = transactionAmountCents(candidate)
	if !ok || candidateCents <= 0 {
		return 0, 0, false
	}
	gap := candidate.TransactionTime - stale.TransactionTime
	if gap < -windowSeconds || gap > windowSeconds {
		return 0, 0, false
	}
	if !namesMatch(candidate.Name, stale.Name) {
		return 0, 0, false
	}
	return staleCents, candidateCents, true
}

func settleMatch(stale types.Transaction, candidate types.Transaction) bool {
	staleCents, candidateCents, ok := settleStrictJoinKeys(stale, candidate)
	return ok && staleCents == candidateCents
}

// settleMatchTolerant applies the merchant profile's amount policy. Exact
// matches always qualify. Near matches still require a unique candidate,
// enforced by the caller's ambiguity guard.
func settleMatchTolerant(stale types.Transaction, candidate types.Transaction) bool {
	_, ok := settleCandidate(stale, candidate)
	return ok
}

// rowAccount returns the model account a bank transaction touches.
func rowAccount(transaction types.Transaction) (string, bool) {
	if transaction.SourceAccountID != nil {
		return *transaction.SourceAccountID, true
	}
	if len(transaction.Destinations) > 0 {
		return transaction.Destinations[0], true
	}
	return "", false
}

// settledGroupKey buckets settled rows by the same join prefix settleJoinKeys
// filters on: mirror account plus outflow direction. Amount, time window,
// and name checks still run per candidate inside the bucket.
func settledGroupKey(account string, outflow bool) string {
	if outflow {
		return account + "\x001"
	}
	return account + "\x000"
}

func bankKey(provider, account, transaction string) store.BankKey {
	return store.BankKey{Provider: provider, AccountID: account, TransactionID: transaction}
}

func hasSimpleFINKey(row store.BankRow) bool {
	for _, key := range row.Keys {
		if key.Provider == store.ProviderSimpleFIN {
			return true
		}
	}
	return false
}

func candidateKey(item store.SyncTransaction) store.BankKey {
	// The provider identity is SimpleFIN knowledge: pending authorizations
	// and posted charges from this bridge share one key namespace, which is
	// what lets a posted charge convert the pending row it settles.
	return bankKey(store.ProviderSimpleFIN, item.ProviderAccountID, item.TransactionID)
}

// Reconcile translates one mapped snapshot plus loaded bank rows into store
// directives. Pending items upsert by key; vanished pending rows void in
// place; unmatched posted charges insert as new rows. A posted charge that
// settles a vanished hold updates that hold in place (same UUID, keys
// rotated, occurrence claim kept) instead of voiding beside a new row: the
// hold becomes the posted charge. Only this provider's rows and keys
// participate; other providers' bank rows are invisible to it. Covered limits
// stale handling to resolved accounts so unlinked accounts' rows are never
// touched. A candidate whose key already points at a settled row is already
// imported and never reprocesses, so repeat feeds are stable no-ops. Keys that
// point only at pending or void rows never suppress a settled candidate. The
// settled-to-settled duplicate check stays exact so near-amount repeats never
// suppress a genuine second charge.
func Reconcile(pending, settled []store.SyncTransaction, bank []store.BankRow, covered map[string]bool) []store.BankDirective {
	byKey := map[store.BankKey]string{}
	byID := map[string]store.BankRow{}
	for _, row := range bank {
		if row.Transaction.Source != store.SourceBankSync {
			continue
		}
		byID[row.Transaction.ID] = row
		for _, key := range row.Keys {
			if key.Provider != store.ProviderSimpleFIN {
				continue
			}
			byKey[key] = row.Transaction.ID
		}
	}
	var directives []store.BankDirective
	seen := map[string]bool{}
	// Pending upserts are intentionally ungated by coverage: the translation
	// emits them only for resolved accounts.
	for _, item := range pending {
		directives = append(directives, store.BankDirective{
			Upsert: &store.BankUpsert{Transaction: item.Transaction, Keys: []store.BankKey{candidateKey(item)}, Facts: item.Facts},
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
		if seen[row.Transaction.ID] || row.Transaction.Source != store.SourceBankSync || !hasSimpleFINKey(row) {
			continue
		}
		if row.Transaction.Pending || row.Transaction.Void {
			stale = append(stale, staleRow{id: row.Transaction.ID, pending: row.Transaction.Pending})
		}
	}
	recordedSettled := func(item store.SyncTransaction) bool {
		id, ok := byKey[candidateKey(item)]
		if !ok {
			return false
		}
		row, ok := byID[id]
		if !ok {
			return true
		}
		return !row.Transaction.Pending && !row.Transaction.Void
	}
	coveredAccount := func(item store.SyncTransaction) bool {
		account, ok := rowAccount(item.Transaction)
		return ok && covered[account]
	}
	settledByAccount := map[string][]store.BankRow{}
	for _, row := range bank {
		if row.Transaction.Source != store.SourceBankSync || !hasSimpleFINKey(row) {
			continue
		}
		if row.Transaction.Pending || row.Transaction.Void {
			continue
		}
		// Claimed occurrences never suppress: a settlement matching one
		// joins it through the convert below instead of dropping as an
		// already-imported repeat.
		if row.Transaction.Claim != nil {
			continue
		}
		account, ok := rowAccount(row.Transaction)
		if !ok {
			continue
		}
		key := settledGroupKey(account, rowOutflow(row.Transaction))
		settledByAccount[key] = append(settledByAccount[key], row)
	}
	duplicateSuppressed := func(candidate store.SyncTransaction) bool {
		// A candidate matching an existing settled bank row is already
		// imported. The check stays exact: a near-amount repeat at the
		// same merchant is a genuine second charge, not a repost.
		// Void rows never suppress: the void record stays and the
		// posted charge inserts as its own row.
		account, ok := rowAccount(candidate.Transaction)
		if !ok {
			return false
		}
		key := settledGroupKey(account, rowOutflow(candidate.Transaction))
		for _, row := range settledByAccount[key] {
			if settleMatch(row.Transaction, candidate.Transaction) {
				return true
			}
		}
		return false
	}
	// A posted charge that settles a vanished hold converts that hold in
	// place: the hold keeps its UUID (and any occurrence claim on it) and
	// takes the posted values with the posted key. Eligible holds are
	// vanished pending rows plus vanished claimed occurrences, matched by
	// the same merchant-profile join the candidate endpoint uses. The join
	// needs a unique pair: several candidates for one hold, or several
	// holds for one candidate, fall back to void-plus-insert for the owner
	// to resolve by hand. Zero-amount auths never join, direction
	// mismatches never join, and uncovered accounts never convert.
	// Same-key settles keep flowing through the upsert below, which
	// resolves by key to the same row.
	feedKeys := map[store.BankKey]bool{}
	for _, item := range pending {
		feedKeys[candidateKey(item)] = true
	}
	for _, candidate := range settled {
		feedKeys[candidateKey(candidate)] = true
	}
	type convertTarget struct {
		id          string
		transaction types.Transaction
	}
	var targets []convertTarget
	for _, row := range bank {
		if row.Transaction.Source != store.SourceBankSync || !hasSimpleFINKey(row) {
			continue
		}
		account, ok := rowAccount(row.Transaction)
		if !ok || !covered[account] {
			continue
		}
		live := false
		for _, key := range row.Keys {
			if feedKeys[key] {
				live = true
				break
			}
		}
		if live {
			continue
		}
		if row.Transaction.Pending {
			targets = append(targets, convertTarget{id: row.Transaction.ID, transaction: row.Transaction})
		} else if row.Transaction.Claim != nil && !row.Transaction.Void {
			targets = append(targets, convertTarget{id: row.Transaction.ID, transaction: row.Transaction})
		}
	}
	consumable := func(candidate store.SyncTransaction) bool {
		if recordedSettled(candidate) || !coveredAccount(candidate) || duplicateSuppressed(candidate) {
			return false
		}
		if _, known := byKey[candidateKey(candidate)]; known {
			return false
		}
		return true
	}
	matches := make([][]int, len(settled))
	targetHits := make([]int, len(targets))
	for ci, candidate := range settled {
		if !consumable(candidate) {
			continue
		}
		for ti := range targets {
			if !profileForTransaction(targets[ti].transaction).AutoConvert {
				continue
			}
			if settleMatchTolerant(targets[ti].transaction, candidate.Transaction) {
				matches[ci] = append(matches[ci], ti)
				targetHits[ti]++
			}
		}
	}
	convertedCandidate := make([]bool, len(settled))
	convertedTarget := map[string]bool{}
	for ci, candidate := range settled {
		if len(matches[ci]) != 1 {
			continue
		}
		ti := matches[ci][0]
		if targetHits[ti] != 1 {
			continue
		}
		target := targets[ti]
		directives = append(directives, store.BankDirective{Convert: &store.BankConvert{
			ID:          target.id,
			Transaction: candidate.Transaction,
			AddKeys:     []store.BankKey{candidateKey(candidate)},
			Facts:       candidate.Facts,
		}})
		convertedCandidate[ci] = true
		convertedTarget[target.id] = true
	}
	// Settled candidates that reuse a hold's id convert that hold instead of
	// leaving a void without a charge. Collect them before voiding so a
	// converting hold never voids first.
	willConvert := map[store.BankKey]bool{}
	for _, candidate := range settled {
		if recordedSettled(candidate) || !coveredAccount(candidate) || duplicateSuppressed(candidate) {
			continue
		}
		willConvert[candidateKey(candidate)] = true
	}
	convertsHold := func(row store.BankRow) bool {
		for _, key := range row.Keys {
			if key.Provider != store.ProviderSimpleFIN {
				continue
			}
			if willConvert[key] {
				return true
			}
		}
		return false
	}
	// Vanished holds void in place, unless a posted charge converted the
	// hold above: the hold then carries the posted values under its own id.
	for _, entry := range stale {
		row := byID[entry.id]
		if account, ok := rowAccount(row.Transaction); !ok || !covered[account] {
			continue
		}
		if entry.pending {
			if convertedTarget[entry.id] || convertsHold(row) {
				continue
			}
			directives = append(directives, store.BankDirective{Void: entry.id})
		}
	}
	for ci, candidate := range settled {
		if convertedCandidate[ci] {
			continue
		}
		if recordedSettled(candidate) || !coveredAccount(candidate) {
			continue
		}
		if duplicateSuppressed(candidate) {
			continue
		}
		directives = append(directives, store.BankDirective{
			Upsert: &store.BankUpsert{Transaction: candidate.Transaction, Keys: []store.BankKey{candidateKey(candidate)}, Facts: candidate.Facts},
		})
	}
	// Evidence refreshes also apply to known settled keys, independently of the
	// transaction directives. This preserves metadata without overwriting owner edits.
	for _, items := range [][]store.SyncTransaction{pending, settled} {
		for _, item := range items {
			if item.Facts != nil {
				directives = append(directives, store.BankDirective{Observe: &store.BankObservation{Keys: []store.BankKey{candidateKey(item)}, Facts: *item.Facts}})
			}
		}
	}
	return directives
}
