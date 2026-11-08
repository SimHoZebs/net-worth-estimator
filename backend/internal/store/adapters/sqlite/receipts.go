package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func receiptTransaction(q queryer, id string) (types.Transaction, error) {
	rows, err := q.Query(`SELECT `+transactionSelect+` `+transactionJoins+` WHERE p.id = ? AND p.user_id = :user_id`, id)
	if err != nil {
		return types.Transaction{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return types.Transaction{}, err
		}
		return types.Transaction{}, ErrReceiptNotFound
	}
	p, err := scanTransactionRow(rows)
	return p, err
}

// GetTransaction reads one transaction for receipt fingerprinting without loading
// the full model. Missing rows report ErrReceiptNotFound.
func (s *sqliteStore) GetTransaction(id string) (types.Transaction, error) {
	return receiptTransaction(s.db, id)
}

func (s *sqliteStore) CreateReceipt(ctx context.Context, transactionID, filename string, image types.ReceiptImage) (out types.Receipt, err error) {
	image, err = validatedReceiptImage(image)
	if err != nil {
		return out, err
	}
	check := func(tx *userTx) error {
		transaction, err := receiptTransaction(tx, transactionID)
		if err != nil {
			return err
		}
		if transaction.SourceAccountID == nil && len(transaction.Destinations) == 0 {
			return ErrReceiptIneligible
		}
		if transaction.Pending || transaction.Void {
			return ErrReceiptIneligible
		}
		var existing string
		if err := tx.QueryRow(`SELECT payload FROM receipts WHERE transaction_id = ? AND digest = ? AND user_id = :user_id`, transactionID, image.Digest).Scan(&existing); err == nil {
			return json.Unmarshal([]byte(existing), &out)
		} else if err != sql.ErrNoRows {
			return err
		}
		var used, count int64
		if err := tx.QueryRow(`SELECT COALESCE(SUM(size),0), COUNT(*) FROM receipts WHERE user_id = :user_id`).Scan(&used, &count); err != nil {
			return err
		}
		if used+int64(len(image.Bytes)) > ReceiptStorageLimit || count >= 500 {
			return ErrReceiptQuota
		}
		out = types.Receipt{TransactionID: transactionID, Filename: filename, MediaType: image.MediaType, Digest: image.Digest, Size: int64(len(image.Bytes)), Revision: 1, Status: "attached", TransactionFingerprint: TransactionReceiptFingerprint(transaction)}
		return nil
	}
	// Reject ineligible parents, duplicates, and quota failures before provider I/O.
	if err := withRowTx(s.db, check); err != nil || out.ID != "" {
		return out, err
	}
	key, err := s.application.stageBlob(ctx, image.Bytes)
	if err != nil {
		return types.Receipt{}, err
	}
	defer s.application.finishBlobWrite(key)
	err = withRowTx(s.db, func(tx *userTx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := check(tx); err != nil || out.ID != "" {
			return err
		}
		id, err := newRowID()
		if err != nil {
			return err
		}
		out.ID, out.CreatedAt = id, time.Now().UTC().Format(time.RFC3339Nano)
		payload, err := json.Marshal(out)
		if err != nil {
			return err
		}
		if err := publishBlob(tx.Tx, key); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO receipts (id, transaction_id, digest, size, blob_key, revision, payload, user_id) VALUES (?,?,?,?,?,?,?, :user_id)`, out.ID, transactionID, image.Digest, out.Size, key, out.Revision, string(payload)); err != nil {
			return err
		}
		// The receipts row itself is the link; no transaction back-reference
		// exists anymore.
		return nil
	})
	return out, err
}

func (s *sqliteStore) ListReceipts(transactionID string) ([]types.Receipt, error) {
	if _, err := receiptTransaction(s.db, transactionID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT payload FROM receipts WHERE transaction_id = ? AND user_id = :user_id ORDER BY id`, transactionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []types.Receipt{}
	for rows.Next() {
		var payload string
		var receipt types.Receipt
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(payload), &receipt); err != nil {
			return nil, err
		}
		out = append(out, receipt)
	}
	return out, rows.Err()
}

// ListTransactionReceiptIDs derives links from the receipts table: each receipt
// row points at its parent transaction, so no transaction-side back-reference is
// stored or read. Only transactions with at least one receipt appear in the map.
func (s *sqliteStore) ListTransactionReceiptIDs() (map[string][]string, error) {
	rows, err := s.db.Query(`SELECT transaction_id, id FROM receipts WHERE user_id = :user_id ORDER BY transaction_id, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var transactionID, id string
		if err := rows.Scan(&transactionID, &id); err != nil {
			return nil, err
		}
		out[transactionID] = append(out[transactionID], id)
	}
	return out, rows.Err()
}

func (s *sqliteStore) GetReceipt(id string) (out types.Receipt, err error) {
	var payload string
	err = s.db.QueryRow(`SELECT payload FROM receipts WHERE id = ? AND user_id = :user_id`, id).Scan(&payload)
	if err == sql.ErrNoRows {
		return out, ErrReceiptNotFound
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal([]byte(payload), &out)
	return out, err
}

func (s *sqliteStore) SaveReceipt(receipt types.Receipt, expectedRevision int64) (types.Receipt, error) {
	for _, details := range []*types.ReceiptDetails{receipt.Draft, receipt.Confirmed} {
		if details != nil {
			if err := types.ValidateReceiptDetails(*details); err != nil {
				return types.Receipt{}, err
			}
		}
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		var payload string
		if err := tx.QueryRow(`SELECT payload FROM receipts WHERE id = ? AND user_id = :user_id`, receipt.ID).Scan(&payload); err == sql.ErrNoRows {
			return ErrReceiptNotFound
		} else if err != nil {
			return err
		}
		var previous types.Receipt
		if err := json.Unmarshal([]byte(payload), &previous); err != nil {
			return err
		}
		if previous.Revision != expectedRevision {
			return ErrReceiptConflict
		}
		// Immutable image/parent attributes cannot change through metadata writes.
		if receipt.TransactionID != previous.TransactionID || receipt.Digest != previous.Digest || receipt.Filename != previous.Filename || receipt.MediaType != previous.MediaType || receipt.Size != previous.Size || receipt.CreatedAt != previous.CreatedAt {
			return fmt.Errorf("receipt image and transaction are immutable")
		}
		receipt.Revision = expectedRevision + 1
		receipt.Stale = false
		data, err := json.Marshal(receipt)
		if err != nil {
			return err
		}
		result, err := tx.Exec(`UPDATE receipts SET payload = ?, revision = ? WHERE id = ? AND revision = ? AND user_id = :user_id`, string(data), receipt.Revision, receipt.ID, expectedRevision)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err == nil && count == 0 {
			return ErrReceiptConflict
		}
		return err
	})
	return receipt, err
}

func (s *sqliteStore) DeleteReceipt(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		var exists string
		if err := tx.QueryRow(`SELECT transaction_id FROM receipts WHERE id = ? AND user_id = :user_id`, id).Scan(&exists); err == sql.ErrNoRows {
			return ErrReceiptNotFound
		} else if err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM receipts WHERE id = ? AND user_id = :user_id`, id); err != nil {
			return err
		}
		// Deleting the receipt row removes the link; nothing else to clean.
		return nil
	})
	if err == nil {
		s.application.finishBlobWrite("")
	}
	return err
}

func bankTransactionIDs(transactions []types.Transaction) []string {
	ids := make([]string, 0, len(transactions))
	for _, transaction := range transactions {
		ids = append(ids, transaction.ID)
	}
	return ids
}

type preservedReceipt struct {
	id, transactionID, digest, blobKey, payload string
	size                                        int64
	revision                                    int64
}

// loadReceiptsForTransactions snapshots receipt rows so model replacement can
// restore evidence for preserved transactions after row deletion cascades.
func loadReceiptsForTransactions(tx *userTx, transactionIDs []string) ([]preservedReceipt, error) {
	if len(transactionIDs) == 0 {
		return nil, nil
	}
	var out []preservedReceipt
	const chunkSize = 500
	for start := 0; start < len(transactionIDs); start += chunkSize {
		end := start + chunkSize
		if end > len(transactionIDs) {
			end = len(transactionIDs)
		}
		chunk := transactionIDs[start:end]
		placeholders := make([]string, len(chunk))
		args := make([]any, len(chunk))
		for i, id := range chunk {
			placeholders[i] = "?"
			args[i] = id
		}
		rows, err := tx.Query(`SELECT id, transaction_id, digest, size, blob_key, revision, payload FROM receipts WHERE transaction_id IN (`+strings.Join(placeholders, ",")+`) AND user_id = :user_id ORDER BY id`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var receipt preservedReceipt
			if err := rows.Scan(&receipt.id, &receipt.transactionID, &receipt.digest, &receipt.size, &receipt.blobKey, &receipt.revision, &receipt.payload); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, receipt)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}

func restoreReceipts(tx *userTx, receipts []preservedReceipt) error {
	for _, receipt := range receipts {
		// Row deletion cascades to receipts and queues their blobs for
		// cleanup; reviving the reference must unqueue the object first.
		if _, err := tx.Exec(`UPDATE blob_objects SET state = 'live', expires_at = 0 WHERE key = ?`, receipt.blobKey); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO receipts (id, transaction_id, digest, size, blob_key, revision, payload, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, :user_id)`,
			receipt.id, receipt.transactionID, receipt.digest, receipt.size, receipt.blobKey, receipt.revision, receipt.payload); err != nil {
			return err
		}
	}
	return nil
}
