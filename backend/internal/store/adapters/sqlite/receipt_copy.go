package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ReceiptCopy is an offline copy prepared through blob ports before the target
// metadata transaction starts. Close retires unpublished uploads after rollback.
type ReceiptCopy struct {
	database *Database
	rows     []copiedReceipt
}

type copiedReceipt struct {
	receipt types.Receipt
	payload string
	key     string
}

// PrepareReceiptCopy reads only the selected source account. The source connection
// and source blob adapter belong to the offline command's composition boundary.
func (d *Database) PrepareReceiptCopy(ctx context.Context, source *sql.DB, blobs blobstore.Store, accountID string) (*ReceiptCopy, error) {
	// Finish preparation before an early upload lease can expire. Apply still
	// checks every lease inside the target transaction and fails atomically.
	ctx, cancel := context.WithTimeout(ctx, blobStageLease/2)
	defer cancel()
	rows, err := source.QueryContext(ctx, `SELECT blob_key,payload FROM receipts WHERE account_id=? ORDER BY id`, accountID)
	if err != nil {
		return nil, err
	}
	type incoming struct{ key, payload string }
	var entries []incoming
	for rows.Next() {
		var entry incoming
		if err := rows.Scan(&entry.key, &entry.payload); err != nil {
			rows.Close()
			return nil, err
		}
		entries = append(entries, entry)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	copy := &ReceiptCopy{database: d}
	for _, entry := range entries {
		var receipt types.Receipt
		if err := json.Unmarshal([]byte(entry.payload), &receipt); err != nil {
			copy.Close()
			return nil, err
		}
		reader, err := blobs.Open(ctx, entry.key)
		if err != nil {
			copy.Close()
			return nil, err
		}
		data, readErr := io.ReadAll(io.LimitReader(reader, (3<<20)+1))
		closeErr := reader.Close()
		if readErr != nil {
			copy.Close()
			return nil, readErr
		}
		if closeErr != nil {
			copy.Close()
			return nil, closeErr
		}
		image, err := validatedReceiptImage(types.ReceiptImage{Bytes: data, MediaType: receipt.MediaType})
		if err != nil || image.Digest != receipt.Digest || int64(len(data)) != receipt.Size {
			copy.Close()
			return nil, fmt.Errorf("source receipt blob integrity check failed")
		}
		key, err := d.stageBlob(ctx, data)
		if err != nil {
			copy.Close()
			return nil, err
		}
		copy.rows = append(copy.rows, copiedReceipt{receipt: receipt, payload: entry.payload, key: key})
	}
	return copy, nil
}

// Apply publishes the copied objects and metadata in the caller's financial
// replacement transaction. Parent postings must already exist in that transaction.
func (c *ReceiptCopy) Apply(tx *sql.Tx, accountID string) error {
	for _, row := range c.rows {
		if err := publishBlob(tx, row.key); err != nil {
			return err
		}
		r := row.receipt
		if _, err := tx.Exec(`INSERT INTO receipts(account_id,id,posting_id,digest,size,blob_key,revision,payload) VALUES (?,?,?,?,?,?,?,?)`, accountID, r.ID, r.PostingID, r.Digest, r.Size, row.key, r.Revision, row.payload); err != nil {
			return err
		}
	}
	return nil
}

func (c *ReceiptCopy) Close() {
	for _, row := range c.rows {
		c.database.discardBlob(row.key)
	}
	c.database.finishBlobWrite("")
}
