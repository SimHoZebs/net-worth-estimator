// Package store defines the persistence ports behind the canonical model,
// projection artifacts, and SimpleFIN sync state.
//
// The server, API handlers, and sync runner depend only on the interfaces
// and types in this package. The SQLite file backend lives in
// adapters/sqlite and implements these ports. A replacement backend
// (CSV files, S3 blobs, a human with paper and mic, Turso, Postgres, …)
// implements these interfaces plus a constructor, then runs the
// conformance suite in storetest to prove it.
//
// This package imports no database/sql, no sqlite driver, no file paths,
// and no CSV code. If this package needs a new import for a storage
// mechanism, the abstraction has leaked.
package store

import (
	"errors"
)

// ErrNotFound reports a missing row, plan, group, or member. Backends map
// their native miss signal (sql.ErrNoRows, missing file, …) to this error.
// Handlers map it to 404 without leaking internals.
var ErrNotFound = errors.New("not found")

var ErrAnalysisFeedbackConflict = errors.New("the finding changed; review it again")
var ErrAnalysisFeedbackInvalid = errors.New("invalid analysis feedback")

// ErrPatternToNewScheduleInvalid reports a pattern that cannot become a
// forecast rule: a non-recurring finding or incoherent evidence. Handlers
// map it to 422 and may show its message.
var ErrPatternToNewScheduleInvalid = errors.New("recurring pattern cannot become a forecast rule")

// ErrPatternToNewScheduleConflict reports a pattern whose state changed since
// confirmation, or that already has an active generated rule. Handlers map
// it to 409 and may show its message.
var ErrPatternToNewScheduleConflict = errors.New("recurring pattern changed or already has a forecast rule")

// ErrPatternToExistingScheduleInvalid reports an add request that cannot be honored:
// a non-recurring finding, incoherent evidence, a missing rule, or a claim
// update naming no transaction, rule, or date. Handlers map it to 422 and may
// show its message. Disabled rules, routing mismatches, and off-schedule
// patterns instead preview as Claimable=false with a plain-language reason.
var ErrPatternToExistingScheduleInvalid = errors.New("recurring pattern cannot claim that forecast rule")

// ErrPatternToExistingScheduleConflict reports a pattern whose state changed since
// confirmation, or whose occurrences are already claimed elsewhere.
// Handlers map it to 409 and may show its message.
var ErrPatternToExistingScheduleConflict = errors.New("recurring pattern changed or already claimed")

// ErrTransferLinkInvalid reports a transfer pair that cannot be confirmed:
// a missing or ineligible finding, an unranked peer, or legs that fail the
// settled single-sided opposite-leg rule. Handlers map it to 422 and may
// show its message.
var ErrTransferLinkInvalid = errors.New("transfer pair cannot be confirmed")

// ErrGroupForbidden reports a group action the caller's role may not perform.
// It distinguishes denial (403) from unknown groups or members (404,
// ErrNotFound).
var ErrGroupForbidden = errors.New("forbidden")

// ErrGroupInvalid reports a rejected group request: bad names, unknown
// roles, unusable invites, or violated ownership guards. Handlers map it to
// 400 and may show its message; anything else from the store maps to 503
// without leaking internals.
var ErrGroupInvalid = errors.New("invalid group request")

// ErrSharingConflict reports a social write that lost a race: a request ID
// already completed a different action, or an expected version went stale.
// Handlers map it to 409. The message carries no row content or identities,
// so it is safe to show. Callers retry with a fresh read (and, for a new
// attempt, a new request ID).
var ErrSharingConflict = errors.New("the sharing request conflicts with a committed change")

// ErrSettlementConflict reports a settlement write refused for retry
// safety: a request ID reused for a different settlement, or a real
// payment linked to more than one settlement. Handlers map it to 409.
var ErrSettlementConflict = errors.New("settlement conflicts with a recorded settlement")

// ErrAccountSupersedeInvalid reports a manual account that cannot be
// replaced by a synced account: already bank-owned, linked to a bridge,
// missing payment-term routing, or otherwise not a manual account. Handlers
// map it to 422 and may show its message.
var ErrAccountSupersedeInvalid = errors.New("account cannot be replaced by a synced account")

var (
	ErrReceiptNotFound   = errors.New("receipt or transaction not found")
	ErrReceiptConflict   = errors.New("receipt changed; reload before retrying")
	ErrReceiptDuplicate  = errors.New("this image is already attached to the transaction")
	ErrReceiptIneligible = errors.New("receipts require a saved settled transaction")
	ErrReceiptQuota      = errors.New("receipt storage exceeds the 100 MiB or 500-receipt plan limit")
)

// Row errors map to API statuses: NotFound→404, IDConflict→409,
// InvalidID/SyncOwned/AccountMissing→422.
type rowError struct {
	code string
	id   string
}

func (e *rowError) Error() string { return e.code + ": " + e.id }

// IsNotFound reports a missing-row error.
func IsNotFound(err error) bool {
	return isRowCode(err, "not-found") || errors.Is(err, ErrNotFound) || errors.Is(err, ErrReceiptNotFound)
}

// IsIDConflict reports a duplicate-ID error.
func IsIDConflict(err error) bool { return isRowCode(err, "id-conflict") }

// IsInvalidID reports a transaction ID that is not a canonical UUID.
func IsInvalidID(err error) bool { return isRowCode(err, "invalid-id") }

// IsSyncOwned reports a write refused on a sync-owned row.
func IsSyncOwned(err error) bool { return isRowCode(err, "sync-owned") }

// IsAccountMissing reports a reference to an unknown model account.
func IsAccountMissing(err error) bool { return isRowCode(err, "account-missing") }

// NotFound constructs a missing-row error for the given ID. Backends use
// these constructors so IsNotFound/IsIDConflict/etc. recognize errors from
// any implementation (SQLite, CSV, S3, human with paper and mic).
func NotFound(id string) error { return &rowError{code: "not-found", id: id} }

// IDConflict constructs a duplicate-ID error.
func IDConflict(id string) error { return &rowError{code: "id-conflict", id: id} }

// InvalidID constructs an invalid-ID error.
func InvalidID(id string) error { return &rowError{code: "invalid-id", id: id} }

// SyncOwned constructs a sync-owned write refusal.
func SyncOwned(id string) error { return &rowError{code: "sync-owned", id: id} }

// AccountMissing constructs an unknown-account reference error.
func AccountMissing(id string) error { return &rowError{code: "account-missing", id: id} }

func isRowCode(err error, code string) bool {
	var target *rowError
	if as := asRowError(err); as != nil {
		target = as
		return target.code == code
	}
	return false
}

func asRowError(err error) *rowError {
	for err != nil {
		if re, ok := err.(*rowError); ok {
			return re
		}
		if un, ok := err.(interface{ Unwrap() error }); ok {
			err = un.Unwrap()
			continue
		}
		if un, ok := err.(interface{ Unwrap() []error }); ok {
			for _, inner := range un.Unwrap() {
				if re := asRowError(inner); re != nil {
					return re
				}
			}
			return nil
		}
		return nil
	}
	return nil
}
