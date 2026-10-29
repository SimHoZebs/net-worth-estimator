package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func validatedReceiptImage(image types.ReceiptImage) (types.ReceiptImage, error) {
	if len(image.Bytes) == 0 || len(image.Bytes) > 3<<20 || (image.MediaType != "image/png" && image.MediaType != "image/jpeg") {
		return image, fmt.Errorf("invalid normalized receipt image")
	}
	digest := sha256.Sum256(image.Bytes)
	image.Digest = hex.EncodeToString(digest[:])
	return image, nil
}

func (s *sqliteStore) GetReceiptImage(ctx context.Context, id string) (types.ReceiptImage, error) {
	ctx, cancel := context.WithTimeout(ctx, blobOperationTimeout)
	defer cancel()
	for attempt := 0; attempt < 5; attempt++ {
		var payload, key string
		err := s.db.QueryRow(`SELECT blob_key,payload FROM receipts WHERE id=? AND plan_id=:plan_id`, id).Scan(&key, &payload)
		if err == sql.ErrNoRows {
			return types.ReceiptImage{}, ErrReceiptNotFound
		}
		if err != nil {
			return types.ReceiptImage{}, err
		}
		var receipt types.Receipt
		if err := json.Unmarshal([]byte(payload), &receipt); err != nil {
			return types.ReceiptImage{}, err
		}
		reader, err := s.application.blobs.Open(ctx, key)
		if errors.Is(err, blobstore.ErrNotFound) {
			// Replacement can retire the captured object before Open. Retry only
			// if this receipt moved to a different immutable object.
			var current string
			if scanErr := s.db.QueryRow(`SELECT blob_key FROM receipts WHERE id=? AND plan_id=:plan_id`, id).Scan(&current); scanErr == sql.ErrNoRows {
				return types.ReceiptImage{}, ErrReceiptNotFound
			} else if scanErr != nil {
				return types.ReceiptImage{}, scanErr
			}
			if current != key {
				continue
			}
		}
		if err != nil {
			return types.ReceiptImage{}, err
		}
		data, readErr := io.ReadAll(io.LimitReader(reader, (3<<20)+1))
		closeErr := reader.Close()
		if err := errors.Join(readErr, closeErr, ctx.Err()); err != nil {
			return types.ReceiptImage{}, err
		}
		image, err := validatedReceiptImage(types.ReceiptImage{Bytes: data, MediaType: receipt.MediaType})
		if err != nil || image.Digest != receipt.Digest || int64(len(data)) != receipt.Size {
			return types.ReceiptImage{}, fmt.Errorf("receipt blob integrity check failed")
		}
		return image, nil
	}
	return types.ReceiptImage{}, ErrReceiptConflict
}

// ReplaceReceiptImage atomically replaces pixels and clears all derived content.
// The receipt identity and posting link remain stable. Metadata writes cannot
// change images through SaveReceipt.
func (s *sqliteStore) ReplaceReceiptImage(ctx context.Context, id string, expectedRevision int64, filename string, image types.ReceiptImage) (out types.Receipt, err error) {
	image, err = validatedReceiptImage(image)
	if err != nil {
		return out, err
	}
	var previous types.Receipt
	check := func(tx *planTx) error {
		var payload string
		var oldSize int64
		if err := tx.QueryRow(`SELECT payload, size FROM receipts WHERE id = ? AND plan_id = :plan_id`, id).Scan(&payload, &oldSize); err == sql.ErrNoRows {
			return ErrReceiptNotFound
		} else if err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(payload), &previous); err != nil {
			return err
		}
		if previous.Revision != expectedRevision {
			return ErrReceiptConflict
		}
		var duplicates int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM receipts WHERE posting_id = ? AND digest = ? AND id != ? AND plan_id = :plan_id`, previous.PostingID, image.Digest, id).Scan(&duplicates); err != nil {
			return err
		}
		if duplicates > 0 {
			return ErrReceiptDuplicate
		}
		var used int64
		if err := tx.QueryRow(`SELECT COALESCE(SUM(size),0) FROM receipts WHERE plan_id = :plan_id`).Scan(&used); err != nil {
			return err
		}
		if used-oldSize+int64(len(image.Bytes)) > ReceiptStorageLimit {
			return ErrReceiptQuota
		}
		return nil
	}
	if err := withRowTx(s.db, check); err != nil {
		return out, err
	}
	key, err := s.application.stageBlob(ctx, image.Bytes)
	if err != nil {
		return out, err
	}
	defer s.application.finishBlobWrite(key)
	err = withRowTx(s.db, func(tx *planTx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := check(tx); err != nil {
			return err
		}
		posting, err := receiptPosting(tx, previous.PostingID)
		if err != nil {
			return err
		}
		out = types.Receipt{ID: previous.ID, PostingID: previous.PostingID, CreatedAt: previous.CreatedAt,
			Filename: filename, MediaType: image.MediaType, Size: int64(len(image.Bytes)), Digest: image.Digest,
			Revision: expectedRevision + 1, Status: "attached", PostingFingerprint: PostingReceiptFingerprint(posting)}
		data, err := json.Marshal(out)
		if err != nil {
			return err
		}
		if err := publishBlob(tx.Tx, key); err != nil {
			return err
		}
		result, err := tx.Exec(`UPDATE receipts SET digest = ?, size = ?, blob_key = ?, revision = ?, payload = ? WHERE id = ? AND revision = ? AND plan_id = :plan_id`, image.Digest, out.Size, key, out.Revision, string(data), id, expectedRevision)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err == nil && count == 0 {
			return ErrReceiptConflict
		}
		return err
	})
	return out, err
}
