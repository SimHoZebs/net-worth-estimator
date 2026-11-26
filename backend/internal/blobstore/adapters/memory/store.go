// Package memory provides a deterministic in-memory blobstore for fixtures
// and tests. It has no persistence and is never used for private user blobs.
package memory

import (
	"bytes"
	"context"
	"io"
	"math"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

// Store implements blobstore.Store with immutable byte slices.
type Store struct {
	mu      sync.RWMutex
	objects map[string][]byte
}

var _ blobstore.Store = (*Store)(nil)

func New() *Store { return &Store{objects: map[string][]byte{}} }

func (s *Store) Put(ctx context.Context, key string, reader io.Reader, size int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !blobstore.ValidKey(key) || size < 0 || size == math.MaxInt64 {
		return blobstore.ErrInvalid
	}
	data, err := io.ReadAll(io.LimitReader(reader, size+1))
	if err != nil {
		return err
	}
	if int64(len(data)) != size {
		return blobstore.ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.objects[key]; ok && !bytes.Equal(existing, data) {
		return blobstore.ErrConflict
	}
	s.objects[key] = bytes.Clone(data)
	return nil
}

func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !blobstore.ValidKey(key) {
		return nil, blobstore.ErrInvalid
	}
	s.mu.RLock()
	data, ok := s.objects[key]
	s.mu.RUnlock()
	if !ok {
		return nil, blobstore.ErrNotFound
	}
	return &reader{ctx: ctx, reader: bytes.NewReader(bytes.Clone(data))}, nil
}

func (s *Store) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !blobstore.ValidKey(key) {
		return blobstore.ErrInvalid
	}
	s.mu.Lock()
	delete(s.objects, key)
	s.mu.Unlock()
	return nil
}

type reader struct {
	ctx    context.Context
	reader *bytes.Reader
}

func (r *reader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(data)
}

func (r *reader) Close() error { return nil }
