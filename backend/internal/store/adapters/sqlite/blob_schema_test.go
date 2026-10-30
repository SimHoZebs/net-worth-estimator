package sqlite

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSetupAndRuntimeRejectInlineReceiptBlobsWithoutChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s := privateTestPlan(t, d, "owner")
	p := seedReceiptPosting(t, s)
	image := types.ReceiptImage{Bytes: []byte("old normalized image"), MediaType: "image/png"}
	r, err := s.CreateReceipt(t.Context(), p.ID, "old.png", image)
	if err != nil {
		t.Fatal(err)
	}
	var payload string
	if err := s.db.QueryRow(`SELECT payload FROM receipts WHERE id=? AND user_id=:user_id`, r.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`DROP TABLE receipts`, `DELETE FROM blob_data`, `DELETE FROM blob_objects`,
		`CREATE TABLE receipts (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			id TEXT NOT NULL, posting_id TEXT NOT NULL, digest TEXT NOT NULL,
			size INTEGER NOT NULL CHECK(size>0), image BLOB NOT NULL,
			revision INTEGER NOT NULL, payload TEXT NOT NULL,
			PRIMARY KEY(user_id,id), UNIQUE(user_id,posting_id,digest),
			FOREIGN KEY(user_id,posting_id) REFERENCES postings(user_id,id) ON DELETE CASCADE)`,
	} {
		if _, err := d.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.db.Exec(`INSERT INTO receipts(user_id,id,posting_id,digest,size,image,revision,payload) VALUES (?,?,?,?,?,?,?,?)`, s.db.userID, r.ID, r.PostingID, r.Digest, r.Size, image.Bytes, r.Revision, payload); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, open := range []func() (*Database, error){
		func() (*Database, error) { return OpenDatabase(path) },
		func() (*Database, error) { return SetupDatabase(path) },
		func() (*Database, error) { return SetupDatabase(path, WithBlobStore(&faultBlobs{})) },
	} {
		if db, err := open(); !errors.Is(err, ErrSetupRequired) {
			if db != nil {
				db.Close()
			}
			t.Fatalf("inline schema accepted: %v", err)
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected inline schema changed", err)
		}
		assertFileMode(t, path, 0640)
	}
	inspection, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer inspection.Close()
	var preserved []byte
	var storedPayload string
	if err := inspection.QueryRow(`SELECT image,payload FROM receipts WHERE id=?`, r.ID).Scan(&preserved, &storedPayload); err != nil || !bytes.Equal(preserved, image.Bytes) || storedPayload != payload {
		t.Fatal("rejected setup changed receipt evidence", err)
	}
}

func TestSetupRejectsMissingBlobLifecycleObjects(t *testing.T) {
	for _, statement := range []string{`DROP TRIGGER receipt_blob_delete`, `DROP INDEX blob_cleanup`, `DROP INDEX receipt_blob_key`} {
		t.Run(statement, func(t *testing.T) {
			d := openSharedTestDatabase(t)
			if _, err := d.db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			before := databaseSchemaSnapshot(t, d)
			if err := d.setupSchema(); !errors.Is(err, ErrSetupRequired) {
				t.Fatalf("incomplete lifecycle schema accepted: %v", err)
			}
			if after := databaseSchemaSnapshot(t, d); !reflect.DeepEqual(before, after) {
				t.Fatal("setup repaired an existing schema")
			}
		})
	}
}
