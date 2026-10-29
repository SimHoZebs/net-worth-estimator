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

// ErrGroupForbidden reports a group action the caller's role may not perform.
// It distinguishes denial (403) from unknown groups or members (404,
// ErrNotFound).
var ErrGroupForbidden = errors.New("forbidden")

// ErrGroupInvalid reports a rejected group request: bad names, unknown
// roles, unusable invites, or violated ownership guards. Handlers map it to
// 400 and may show its message; anything else from the store maps to 503
// without leaking internals.
var ErrGroupInvalid = errors.New("invalid group request")

var (
	ErrReceiptNotFound   = errors.New("receipt or posting not found")
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

// IsInvalidID reports a posting ID that is not a canonical UUID.
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
