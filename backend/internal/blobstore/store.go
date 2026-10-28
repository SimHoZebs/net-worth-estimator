// Package blobstore defines private, provider-neutral binary object storage.
package blobstore

import (
	"context"
	"errors"
	"io"
)

var (
	ErrNotFound = errors.New("blob not found")
	ErrConflict = errors.New("blob key already contains different bytes")
	ErrInvalid  = errors.New("invalid blob key or length")
)

// Store contains no receipt, plan, SQL, filesystem, or provider SDK types.
// Keys are application-generated and immutable. Put is idempotent for the same
// key and bytes and returns ErrConflict for different bytes. Delete is idempotent.
// Implementations support concurrent use, honor cancellation, and keep objects private.
// Callers own the reader returned by Open and must close it.
type Store interface {
	Put(context.Context, string, io.Reader, int64) error
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}

// ValidKey keeps keys portable across filesystems and object stores. Keys are
// opaque identifiers, never user filenames, paths, URLs, or authorization tokens.
func ValidKey(key string) bool {
	if len(key) == 0 || len(key) > 200 {
		return false
	}
	for _, r := range key {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
