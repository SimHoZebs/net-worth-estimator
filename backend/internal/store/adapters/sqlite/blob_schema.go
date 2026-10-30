package sqlite

import "fmt"

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
