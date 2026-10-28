// Package storetest provides the conformance gate for every blob adapter.
package storetest

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

func Run(t *testing.T, newStore func(*testing.T) blobstore.Store) {
	t.Helper()
	t.Run("immutable-round-trip", func(t *testing.T) {
		s := newStore(t)
		ctx := context.Background()
		data := []byte{0, 1, 2, 255, 0}
		for i := 0; i < 2; i++ {
			if err := s.Put(ctx, "object-key", bytes.NewReader(data), int64(len(data))); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.Put(ctx, "object-key", bytes.NewReader([]byte("changed")), 7); !errors.Is(err, blobstore.ErrConflict) {
			t.Fatalf("overwrite = %v", err)
		}
		reader, err := s.Open(ctx, "object-key")
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(reader)
		closeErr := reader.Close()
		if err != nil || closeErr != nil || !bytes.Equal(got, data) {
			t.Fatalf("read = %v %v %v", got, err, closeErr)
		}
		for i := 0; i < 2; i++ {
			if err := s.Delete(ctx, "object-key"); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := s.Open(ctx, "object-key"); !errors.Is(err, blobstore.ErrNotFound) {
			t.Fatalf("missing object = %v", err)
		}
	})
	t.Run("invalid-upload-never-publishes", func(t *testing.T) {
		s := newStore(t)
		ctx := context.Background()
		for _, size := range []int64{-1, 2, 4} {
			if err := s.Put(ctx, "invalid-size", bytes.NewBufferString("abc"), size); !errors.Is(err, blobstore.ErrInvalid) {
				t.Fatalf("size %d = %v", size, err)
			}
		}
		if err := s.Put(ctx, "invalid-size", failedReader{}, 4); err == nil {
			t.Fatal("reader failure ignored")
		}
		if _, err := s.Open(ctx, "invalid-size"); !errors.Is(err, blobstore.ErrNotFound) {
			t.Fatalf("partial object = %v", err)
		}
		for _, key := range []string{"", "../escape", "a/b", "a\\b", ".hidden", "https://bucket/key"} {
			if err := s.Put(ctx, key, bytes.NewReader(nil), 0); !errors.Is(err, blobstore.ErrInvalid) {
				t.Fatalf("key %q = %v", key, err)
			}
			if _, err := s.Open(ctx, key); !errors.Is(err, blobstore.ErrInvalid) {
				t.Fatalf("open key %q = %v", key, err)
			}
			if err := s.Delete(ctx, key); !errors.Is(err, blobstore.ErrInvalid) {
				t.Fatalf("delete key %q = %v", key, err)
			}
		}
	})
	t.Run("cancellation", func(t *testing.T) {
		s := newStore(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := s.Put(ctx, "canceled", bytes.NewReader(nil), 0); !errors.Is(err, context.Canceled) {
			t.Fatalf("put = %v", err)
		}
		if _, err := s.Open(ctx, "canceled"); !errors.Is(err, context.Canceled) {
			t.Fatalf("open = %v", err)
		}
		if err := s.Delete(ctx, "canceled"); !errors.Is(err, context.Canceled) {
			t.Fatalf("delete = %v", err)
		}
		if err := s.Put(context.Background(), "read-cancel", bytes.NewBufferString("data"), 4); err != nil {
			t.Fatal(err)
		}
		readCtx, stop := context.WithCancel(context.Background())
		reader, err := s.Open(readCtx, "read-cancel")
		if err != nil {
			t.Fatal(err)
		}
		stop()
		_, readErr := io.ReadAll(reader)
		reader.Close()
		if !errors.Is(readErr, context.Canceled) {
			t.Fatalf("canceled read = %v", readErr)
		}
	})
	t.Run("concurrent-writers", func(t *testing.T) {
		s := newStore(t)
		results := make(chan error, 2)
		for _, data := range []string{"first", "other"} {
			go func() {
				results <- s.Put(context.Background(), "contended", bytes.NewBufferString(data), int64(len(data)))
			}()
		}
		var successes, conflicts int
		for i := 0; i < 2; i++ {
			err := <-results
			if err == nil {
				successes++
			} else if errors.Is(err, blobstore.ErrConflict) {
				conflicts++
			} else {
				t.Error(err)
			}
		}
		if successes != 1 || conflicts != 1 {
			t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
		}
	})
	t.Run("no-partial-read", func(t *testing.T) {
		s := newStore(t)
		reader, writer := io.Pipe()
		done := make(chan error, 1)
		go func() { done <- s.Put(context.Background(), "staged", reader, 4) }()
		if _, err := writer.Write([]byte("ab")); err != nil {
			t.Fatal(err)
		}
		_, openErr := s.Open(context.Background(), "staged")
		_, writeErr := writer.Write([]byte("cd"))
		writer.Close()
		putErr := <-done
		reader.Close()
		if !errors.Is(openErr, blobstore.ErrNotFound) || writeErr != nil || putErr != nil {
			t.Fatalf("partial read: %v %v %v", openErr, writeErr, putErr)
		}
	})
}

type failedReader struct{}

func (failedReader) Read([]byte) (int, error) { return 0, errors.New("reader failed") }
