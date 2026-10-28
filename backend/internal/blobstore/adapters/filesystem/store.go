// Package filesystem stores private immutable objects under an explicit root.
package filesystem

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

type Store struct{ root *os.Root }

// New opens an existing private directory. It never creates directories or
// changes permissions. The caller owns Close. No path leaves this adapter.
func New(path string) (*Store, error) {
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	info, err := root.Stat(".")
	if err != nil {
		root.Close()
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		root.Close()
		return nil, fmt.Errorf("blob directory must be owner-only")
	}
	return &Store{root: root}, nil
}

var _ blobstore.Store = (*Store)(nil)

func (s *Store) Close() error { return s.root.Close() }

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(data)
}

func (s *Store) Put(ctx context.Context, key string, reader io.Reader, size int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !blobstore.ValidKey(key) || size < 0 || size == math.MaxInt64 {
		return blobstore.ErrInvalid
	}
	if err := s.root.Mkdir(key, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := s.root.Lstat(key)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return blobstore.ErrInvalid
	}
	temporary := key + "/.upload-" + uuid.NewString()
	file, err := s.root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer s.root.Remove(temporary)
	n, writeErr := io.Copy(file, io.LimitReader(contextReader{ctx, reader}, size+1))
	if writeErr == nil && n != size {
		writeErr = blobstore.ErrInvalid
	}
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if err := errors.Join(writeErr, closeErr, ctx.Err()); err != nil {
		return err
	}
	// A hard link publishes a complete file without overwriting a concurrent
	// writer's object. Temporary files never use valid application object keys.
	if err := s.root.Link(temporary, key+"/data"); err == nil {
		return errors.Join(s.syncDirectory(key), s.syncDirectory("."))
	} else if !errors.Is(err, os.ErrExist) {
		return err
	}
	previous, err := s.Open(ctx, key)
	if err != nil {
		return err
	}
	oldData, readErr := io.ReadAll(io.LimitReader(previous, size+1))
	closeErr = previous.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return err
	}
	newData, err := s.root.ReadFile(temporary)
	if err != nil {
		return err
	}
	if !bytes.Equal(oldData, newData) {
		return blobstore.ErrConflict
	}
	return nil
}

func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !blobstore.ValidKey(key) {
		return nil, blobstore.ErrInvalid
	}
	info, err := s.root.Lstat(key)
	if errors.Is(err, os.ErrNotExist) {
		return nil, blobstore.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, blobstore.ErrInvalid
	}
	info, err = s.root.Lstat(key + "/data")
	if errors.Is(err, os.ErrNotExist) {
		return nil, blobstore.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, blobstore.ErrInvalid
	}
	file, err := s.root.Open(key + "/data")
	if errors.Is(err, os.ErrNotExist) {
		return nil, blobstore.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &contextFile{Reader: contextReader{ctx, file}, Closer: file}, nil
}

type contextFile struct {
	io.Reader
	io.Closer
}

func (s *Store) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !blobstore.ValidKey(key) {
		return blobstore.ErrInvalid
	}
	// Each validated key owns one directory, including any abandoned temporary
	// uploads. Root confines deletion and never follows an outside symlink.
	if err := s.root.RemoveAll(key); err != nil {
		return err
	}
	return s.syncDirectory(".")
}

func (s *Store) syncDirectory(name string) error {
	dir, err := s.root.Open(name)
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}
