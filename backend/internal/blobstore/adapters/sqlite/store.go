// Package sqlite implements private blob storage in the application database.
package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

const Schema = `CREATE TABLE IF NOT EXISTS blob_data (key TEXT PRIMARY KEY, data BLOB NOT NULL)`

type Store struct{ db *sql.DB }

// New never creates or repairs schema. Deployment owns explicit setup.
func New(db *sql.DB) *Store { return &Store{db: db} }

var _ blobstore.Store = (*Store)(nil)

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
	result, err := s.db.ExecContext(ctx, `INSERT INTO blob_data(key,data) VALUES (?,?) ON CONFLICT(key) DO NOTHING`, key, data)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count != 0 {
		return err
	}
	var previous []byte
	if err := s.db.QueryRowContext(ctx, `SELECT data FROM blob_data WHERE key=?`, key).Scan(&previous); err != nil {
		return err
	}
	if !bytes.Equal(previous, data) {
		return blobstore.ErrConflict
	}
	return nil
}

func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	if !blobstore.ValidKey(key) {
		return nil, blobstore.ErrInvalid
	}
	var data []byte
	err := s.db.QueryRowContext(ctx, `SELECT data FROM blob_data WHERE key=?`, key).Scan(&data)
	if err == sql.ErrNoRows {
		return nil, blobstore.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("open blob: %w", err)
	}
	return io.NopCloser(contextReader{ctx: ctx, reader: bytes.NewReader(data)}), nil
}

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

func (s *Store) Delete(ctx context.Context, key string) error {
	if !blobstore.ValidKey(key) {
		return blobstore.ErrInvalid
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM blob_data WHERE key=?`, key)
	return err
}
