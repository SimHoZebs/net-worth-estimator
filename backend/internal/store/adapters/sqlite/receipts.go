package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func receiptPosting(q queryer, id string) (types.Posting, error) {
	rows, err := q.Query(`SELECT id, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, void, execution_order FROM postings WHERE id = ? AND plan_id = :plan_id`, id)
	if err != nil {
		return types.Posting{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return types.Posting{}, err
		}
		return types.Posting{}, ErrReceiptNotFound
	}
	p, err := scanPostingRow(rows)
	return p, err
}

// parsePostingReceiptIDs decodes the stored receipt back-reference. A corrupt
// value reads as empty; the next receipt write for that posting self-heals it.
func parsePostingReceiptIDs(raw string) []string {
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil
	}
	return ids
}

func addPostingReceiptID(tx *planTx, postingID, receiptID string) error {
	var raw string
	if err := tx.QueryRow(`SELECT receipt_ids FROM postings WHERE id = ? AND plan_id = :plan_id`, postingID).Scan(&raw); err != nil {
		return err
	}
	for _, id := range parsePostingReceiptIDs(raw) {
		if id == receiptID {
			return nil
		}
	}
	data, err := json.Marshal(append(parsePostingReceiptIDs(raw), receiptID))
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE postings SET receipt_ids = ? WHERE id = ? AND plan_id = :plan_id`, string(data), postingID)
	return err
}

func removePostingReceiptID(tx *planTx, postingID, receiptID string) error {
	var raw string
	if err := tx.QueryRow(`SELECT receipt_ids FROM postings WHERE id = ? AND plan_id = :plan_id`, postingID).Scan(&raw); err == sql.ErrNoRows {
		return nil
	} else if err != nil {
		return err
	}
	ids := parsePostingReceiptIDs(raw)
	kept := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != receiptID {
			kept = append(kept, id)
		}
	}
	if len(kept) == len(ids) {
		return nil
	}
	data, err := json.Marshal(kept)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE postings SET receipt_ids = ? WHERE id = ? AND plan_id = :plan_id`, string(data), postingID)
	return err
}

// migratePostingReceiptIDs adds the stored receipt back-reference to databases
// created before it and rebuilds every value from the receipts table. It runs
// only inside explicit SetupDatabase, before schema validation.
func migratePostingReceiptIDs(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(postings)`)
	if err != nil {
		return err
	}
	hasColumn := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notnull, &defaultValue, &pk); err != nil {
			rows.Close()
			return err
		}
		hasColumn = hasColumn || name == "receipt_ids"
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if !hasColumn {
		if _, err := tx.Exec(`ALTER TABLE postings ADD COLUMN receipt_ids TEXT NOT NULL DEFAULT '[]'`); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE postings SET receipt_ids = '[]'`); err != nil {
		return err
	}
	rows, err = tx.Query(`SELECT plan_id, posting_id, id FROM receipts ORDER BY plan_id, posting_id, id`)
	if err != nil {
		return err
	}
	type ref struct{ plan, posting, receipt string }
	var refs []ref
	for rows.Next() {
		var r ref
		if err := rows.Scan(&r.plan, &r.posting, &r.receipt); err != nil {
			rows.Close()
			return err
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	grouped := map[string][]string{}
	order := []string{}
	for _, r := range refs {
		key := r.plan + "\x00" + r.posting
		if _, ok := grouped[key]; !ok {
			order = append(order, key)
		}
		grouped[key] = append(grouped[key], r.receipt)
	}
	for _, key := range order {
		data, err := json.Marshal(grouped[key])
		if err != nil {
			return err
		}
		sep := -1
		for i := 0; i < len(key); i++ {
			if key[i] == 0 {
				sep = i
				break
			}
		}
		if sep < 0 {
			return fmt.Errorf("migrate receipt back-references: invalid key")
		}
		if _, err := tx.Exec(`UPDATE postings SET receipt_ids = ? WHERE plan_id = ? AND id = ?`, string(data), key[:sep], key[sep+1:]); err != nil {
			return err
		}
	}
	return nil
}

func (s *sqliteStore) CreateReceipt(ctx context.Context, postingID, filename string, image types.ReceiptImage) (out types.Receipt, err error) {
	image, err = validatedReceiptImage(image)
	if err != nil {
		return out, err
	}
	check := func(tx *planTx) error {
		posting, err := receiptPosting(tx, postingID)
		if err != nil {
			return err
		}
		if posting.SourceAccountID == nil && len(posting.Destinations) == 0 {
			return ErrReceiptIneligible
		}
		if posting.Pending || posting.Void {
			return ErrReceiptIneligible
		}
		var existing string
		if err := tx.QueryRow(`SELECT payload FROM receipts WHERE posting_id = ? AND digest = ? AND plan_id = :plan_id`, postingID, image.Digest).Scan(&existing); err == nil {
			return json.Unmarshal([]byte(existing), &out)
		} else if err != sql.ErrNoRows {
			return err
		}
		var used, count int64
		if err := tx.QueryRow(`SELECT COALESCE(SUM(size),0), COUNT(*) FROM receipts WHERE plan_id = :plan_id`).Scan(&used, &count); err != nil {
			return err
		}
		if used+int64(len(image.Bytes)) > ReceiptStorageLimit || count >= 500 {
			return ErrReceiptQuota
		}
		out = types.Receipt{PostingID: postingID, Filename: filename, MediaType: image.MediaType, Digest: image.Digest, Size: int64(len(image.Bytes)), Revision: 1, Status: "attached", PostingFingerprint: PostingReceiptFingerprint(posting)}
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
	err = withRowTx(s.db, func(tx *planTx) error {
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
		if _, err := tx.Exec(`INSERT INTO receipts (id, posting_id, digest, size, blob_key, revision, payload, plan_id) VALUES (?,?,?,?,?,?,?, :plan_id)`, out.ID, postingID, image.Digest, out.Size, key, out.Revision, string(payload)); err != nil {
			return err
		}
		return addPostingReceiptID(tx, postingID, out.ID)
	})
	return out, err
}

func (s *sqliteStore) ListReceipts(postingID string) ([]types.Receipt, error) {
	if _, err := receiptPosting(s.db, postingID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT payload FROM receipts WHERE posting_id = ? AND plan_id = :plan_id ORDER BY id`, postingID)
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

// ListPostingReceiptIDs reads the stored back-reference from each posting row.
// Only postings with at least one receipt appear in the map.
func (s *sqliteStore) ListPostingReceiptIDs() (map[string][]string, error) {
	rows, err := s.db.Query(`SELECT id, receipt_ids FROM postings WHERE plan_id = :plan_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		ids := parsePostingReceiptIDs(raw)
		if len(ids) != 0 {
			out[id] = ids
		}
	}
	return out, rows.Err()
}

func (s *sqliteStore) GetReceipt(id string) (out types.Receipt, err error) {
	var payload string
	err = s.db.QueryRow(`SELECT payload FROM receipts WHERE id = ? AND plan_id = :plan_id`, id).Scan(&payload)
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
	err := withRowTx(s.db, func(tx *planTx) error {
		var payload string
		if err := tx.QueryRow(`SELECT payload FROM receipts WHERE id = ? AND plan_id = :plan_id`, receipt.ID).Scan(&payload); err == sql.ErrNoRows {
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
		if receipt.PostingID != previous.PostingID || receipt.Digest != previous.Digest || receipt.Filename != previous.Filename || receipt.MediaType != previous.MediaType || receipt.Size != previous.Size || receipt.CreatedAt != previous.CreatedAt {
			return fmt.Errorf("receipt image and posting are immutable")
		}
		receipt.Revision = expectedRevision + 1
		receipt.Stale = false
		data, err := json.Marshal(receipt)
		if err != nil {
			return err
		}
		result, err := tx.Exec(`UPDATE receipts SET payload = ?, revision = ? WHERE id = ? AND revision = ? AND plan_id = :plan_id`, string(data), receipt.Revision, receipt.ID, expectedRevision)
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
	err := withRowTx(s.db, func(tx *planTx) error {
		var postingID string
		if err := tx.QueryRow(`SELECT posting_id FROM receipts WHERE id = ? AND plan_id = :plan_id`, id).Scan(&postingID); err == sql.ErrNoRows {
			return ErrReceiptNotFound
		} else if err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM receipts WHERE id = ? AND plan_id = :plan_id`, id); err != nil {
			return err
		}
		return removePostingReceiptID(tx, postingID, id)
	})
	if err == nil {
		s.application.finishBlobWrite("")
	}
	return err
}

func bankPostingIDs(postings []types.Posting) []string {
	ids := make([]string, 0, len(postings))
	for _, posting := range postings {
		ids = append(ids, posting.ID)
	}
	return ids
}

type preservedReceipt struct {
	id, postingID, digest, blobKey, payload string
	size                                    int64
	revision                                int64
}

// loadReceiptsForPostings snapshots receipt rows so CSV replacement can
// restore evidence for preserved postings after row deletion cascades.
func loadReceiptsForPostings(tx *planTx, postingIDs []string) ([]preservedReceipt, error) {
	var out []preservedReceipt
	for _, postingID := range postingIDs {
		rows, err := tx.Query(`SELECT id, posting_id, digest, size, blob_key, revision, payload FROM receipts WHERE posting_id = ? AND plan_id = :plan_id ORDER BY id`, postingID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var receipt preservedReceipt
			if err := rows.Scan(&receipt.id, &receipt.postingID, &receipt.digest, &receipt.size, &receipt.blobKey, &receipt.revision, &receipt.payload); err != nil {
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

func restoreReceipts(tx *planTx, receipts []preservedReceipt) error {
	for _, receipt := range receipts {
		// Row deletion cascades to receipts and queues their blobs for
		// cleanup; reviving the reference must unqueue the object first.
		if _, err := tx.Exec(`UPDATE blob_objects SET state = 'live', expires_at = 0 WHERE key = ?`, receipt.blobKey); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO receipts (id, posting_id, digest, size, blob_key, revision, payload, plan_id) VALUES (?, ?, ?, ?, ?, ?, ?, :plan_id)`,
			receipt.id, receipt.postingID, receipt.digest, receipt.size, receipt.blobKey, receipt.revision, receipt.payload); err != nil {
			return err
		}
		if err := addPostingReceiptID(tx, receipt.postingID, receipt.id); err != nil {
			return err
		}
	}
	return nil
}

// migratePostingVoidFlag adds the explicit void lifecycle flag to databases
// created before it. No backfill runs: no void row can predate the code that
// writes them, so the column default is already correct everywhere. It runs
// only inside explicit SetupDatabase, before schema validation.
func migratePostingVoidFlag(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(postings)`)
	if err != nil {
		return err
	}
	hasColumn := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notnull, &defaultValue, &pk); err != nil {
			rows.Close()
			return err
		}
		hasColumn = hasColumn || name == "void"
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if !hasColumn {
		if _, err := tx.Exec(`ALTER TABLE postings ADD COLUMN void INTEGER NOT NULL DEFAULT 0 CHECK (void IN (0, 1))`); err != nil {
			return err
		}
	}
	return nil
}
