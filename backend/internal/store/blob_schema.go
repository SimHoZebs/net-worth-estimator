package store

import (
	"database/sql"
	"fmt"
)

const blobObjectSchema = `CREATE TABLE IF NOT EXISTS blob_objects (
	key TEXT PRIMARY KEY,
	state TEXT NOT NULL CHECK(state IN ('staged','live','deleting')),
	expires_at INTEGER NOT NULL
)`

// References publish only completed objects. Cascades and replacement queue
// durable cleanup, including operations outside the receipt service.
var receiptBlobSchemaObjects = []string{
	`CREATE INDEX IF NOT EXISTS blob_cleanup ON blob_objects(state,expires_at,key)`,
	`CREATE INDEX IF NOT EXISTS receipt_blob_key ON receipts(blob_key)`,
	`CREATE TRIGGER IF NOT EXISTS receipt_blob_insert BEFORE INSERT ON receipts BEGIN
		SELECT RAISE(ABORT, 'receipt blob is not live') WHERE NOT EXISTS (
			SELECT 1 FROM blob_objects WHERE key=NEW.blob_key AND state='live'); END`,
	`CREATE TRIGGER IF NOT EXISTS receipt_blob_update BEFORE UPDATE OF blob_key ON receipts BEGIN
		SELECT RAISE(ABORT, 'receipt blob is not live') WHERE NOT EXISTS (
			SELECT 1 FROM blob_objects WHERE key=NEW.blob_key AND state='live'); END`,
	`CREATE TRIGGER IF NOT EXISTS receipt_blob_delete AFTER DELETE ON receipts BEGIN
		UPDATE blob_objects SET state='deleting', expires_at=0 WHERE key=OLD.blob_key
		AND NOT EXISTS (SELECT 1 FROM receipts WHERE blob_key=OLD.blob_key); END`,
	`CREATE TRIGGER IF NOT EXISTS receipt_blob_replace AFTER UPDATE OF blob_key ON receipts
		WHEN OLD.blob_key != NEW.blob_key BEGIN
		UPDATE blob_objects SET state='deleting', expires_at=0 WHERE key=OLD.blob_key
		AND NOT EXISTS (SELECT 1 FROM receipts WHERE blob_key=OLD.blob_key); END`,
}

// migrateInlineReceiptImages runs only inside explicit SetupDatabase. It
// preserves receipt identities, metadata, financial rows, and normalized bytes.
func migrateInlineReceiptImages(tx *sql.Tx, defaultSQLite bool) error {
	rows, err := tx.Query(`PRAGMA table_info(receipts)`)
	if err != nil {
		return err
	}
	inline := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notnull, &defaultValue, &pk); err != nil {
			rows.Close()
			return err
		}
		inline = inline || name == "image"
	}
	err = rows.Err()
	rows.Close()
	if err != nil || !inline {
		return err
	}
	if !defaultSQLite {
		return fmt.Errorf("migrate inline receipt images with the default SQLite adapter before selecting another blob store")
	}
	if _, err := tx.Exec(`ALTER TABLE receipts RENAME TO receipts_inline`); err != nil {
		return err
	}
	if _, err := tx.Exec(receiptSchema); err != nil {
		return err
	}
	rows, err = tx.Query(`SELECT plan_id,id FROM receipts_inline`)
	if err != nil {
		return err
	}
	type identity struct{ plan, id string }
	var identities []identity
	for rows.Next() {
		var id identity
		if err := rows.Scan(&id.plan, &id.id); err != nil {
			rows.Close()
			return err
		}
		identities = append(identities, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range identities {
		key, err := newRowID()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO blob_objects(key,state,expires_at) VALUES (?,'live',0)`, key); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO blob_data(key,data) SELECT ?,image FROM receipts_inline WHERE plan_id=? AND id=?`, key, id.plan, id.id); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO receipts(plan_id,id,posting_id,digest,size,blob_key,revision,payload)
			SELECT plan_id,id,posting_id,digest,size,?,revision,payload FROM receipts_inline WHERE plan_id=? AND id=?`, key, id.plan, id.id); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`DROP TABLE receipts_inline`)
	return err
}

func checkReceiptBlobSchemaObjects(db queryer) error {
	for _, name := range []string{"receipt_blob_insert", "receipt_blob_update", "receipt_blob_delete", "receipt_blob_replace"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name='receipts'`, name).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return fmt.Errorf("%w: missing %s trigger", ErrSetupRequired, name)
		}
	}
	for _, index := range []struct{ name, table string }{{"blob_cleanup", "blob_objects"}, {"receipt_blob_key", "receipts"}} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=? AND tbl_name=?`, index.name, index.table).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return fmt.Errorf("%w: missing %s index", ErrSetupRequired, index.name)
		}
	}
	return nil
}
