package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

const blobOperationTimeout = 45 * time.Second
const blobStageLease = 5 * time.Minute

// WithBlobStore injects an implementation at the composition boundary. Existing
// objects must be copied with their keys before changing a populated backend.
// The caller owns the injected store's lifecycle.
func WithBlobStore(blobs blobstore.Store) DatabaseOption {
	return func(d *Database) error {
		if blobs == nil {
			return fmt.Errorf("blob store is required")
		}
		d.blobs = blobs
		return nil
	}
}

type DatabaseOption func(*Database) error

func (d *Database) stageBlob(ctx context.Context, data []byte) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, blobOperationTimeout)
	defer cancel()
	key, err := newRowID()
	if err != nil {
		return "", err
	}
	if _, err := d.db.ExecContext(ctx, `INSERT INTO blob_objects(key,state,expires_at) VALUES (?,'staged',?)`, key, time.Now().Add(blobStageLease).UnixMilli()); err != nil {
		return "", err
	}
	if err := d.blobs.Put(ctx, key, bytes.NewReader(data), int64(len(data))); err != nil {
		// Keep the lease after an uncertain remote write. A later cleanup retries
		// deletion even if the caller disconnects or this process stops.
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return key, nil
}

func publishBlob(tx *sql.Tx, key string) error {
	result, err := tx.Exec(`UPDATE blob_objects SET state='live',expires_at=0 WHERE key=? AND state='staged' AND expires_at>?`, key, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 1 {
		return fmt.Errorf("blob upload lease expired")
	}
	return err
}

func (d *Database) discardBlob(key string) {
	// A metadata commit may have succeeded despite a caller-side error. Never
	// retire an object that already became live.
	_, _ = d.db.Exec(`UPDATE blob_objects SET state='deleting',expires_at=0 WHERE key=? AND state='staged'`, key)
}

func (d *Database) finishBlobWrite(key string) {
	if key != "" {
		d.discardBlob(key)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Metadata success remains success when physical cleanup needs a retry.
	// The persistent queue and host cleanup loop retain the failed work.
	_ = d.CollectBlobGarbage(ctx, 10)
}

// CollectBlobGarbage retries durable deletion work and abandoned uploads. It
// never lists a provider's bucket or guesses ownership from an object key.
func (d *Database) CollectBlobGarbage(ctx context.Context, limit int) error {
	if limit < 1 || limit > 1000 {
		return fmt.Errorf("blob cleanup limit must be 1..1000")
	}
	rows, err := d.db.QueryContext(ctx, `SELECT key FROM blob_objects WHERE state='deleting' OR (state='staged' AND expires_at<=?) ORDER BY key LIMIT ?`, time.Now().UnixMilli(), limit)
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var failures []error
	for _, key := range keys {
		result, err := d.db.ExecContext(ctx, `UPDATE blob_objects SET state='deleting' WHERE key=? AND (state='deleting' OR (state='staged' AND expires_at<=?))
			AND NOT EXISTS (SELECT 1 FROM receipts WHERE blob_key=blob_objects.key)`, key, time.Now().UnixMilli())
		if err != nil {
			return errors.Join(append(failures, err)...)
		}
		count, err := result.RowsAffected()
		if err != nil {
			return errors.Join(append(failures, err)...)
		}
		if count == 0 {
			continue
		}
		opCtx, cancel := context.WithTimeout(ctx, blobOperationTimeout)
		err = d.blobs.Delete(opCtx, key)
		cancel()
		if err != nil {
			failures = append(failures, fmt.Errorf("delete blob: %w", err))
			continue
		}
		if _, err := d.db.ExecContext(ctx, `DELETE FROM blob_objects WHERE key=? AND state='deleting'`, key); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

// RunBlobCleanup drains persisted work at startup and once per minute. Hosts
// supply cancellation and error reporting and wait for this loop before Close.
func (d *Database) RunBlobCleanup(ctx context.Context, report func(error)) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := d.CollectBlobGarbage(ctx, 100); err != nil && ctx.Err() == nil && report != nil {
			report(err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// StartBlobCleanup returns a stop function that waits before the database closes.
func (d *Database) StartBlobCleanup(parent context.Context, report func(error)) func() {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	go func() { defer close(done); d.RunBlobCleanup(ctx, report) }()
	return func() { cancel(); <-done }
}
