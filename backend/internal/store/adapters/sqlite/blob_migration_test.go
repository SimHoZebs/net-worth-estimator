package sqlite

import (
	"bytes"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestExplicitSetupMigratesInlineReceiptBlobs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s := privateTestPlan(t, d, "migration")
	p := seedReceiptPosting(t, s)
	image := types.ReceiptImage{Bytes: []byte("old normalized image"), MediaType: "image/png"}
	r, err := s.CreateReceipt(t.Context(), p.ID, "old.png", image)
	if err != nil {
		t.Fatal(err)
	}
	r.Confirmed = &types.ReceiptDetails{Merchant: "Preserved correction"}
	r, err = s.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	var payload string
	if err := s.db.QueryRow(`SELECT payload FROM receipts WHERE id=? AND account_id=:account_id`, r.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	before, _ := s.LoadDocument()
	beforeRevision, _ := DocumentETag(before)
	for _, statement := range []string{
		`DROP TABLE receipts`, `DELETE FROM blob_data`, `DELETE FROM blob_objects`,
		`CREATE TABLE receipts (
			account_id TEXT NOT NULL REFERENCES app_accounts(id) ON DELETE CASCADE,
			id TEXT NOT NULL, posting_id TEXT NOT NULL, digest TEXT NOT NULL,
			size INTEGER NOT NULL CHECK(size>0), image BLOB NOT NULL,
			revision INTEGER NOT NULL, payload TEXT NOT NULL,
			PRIMARY KEY(account_id,id), UNIQUE(account_id,posting_id,digest),
			FOREIGN KEY(account_id,posting_id) REFERENCES postings(account_id,id) ON DELETE CASCADE)`,
	} {
		if _, err := d.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.db.Exec(`INSERT INTO receipts(account_id,id,posting_id,digest,size,image,revision,payload) VALUES (?,?,?,?,?,?,?,?)`, s.db.accountID, r.ID, r.PostingID, r.Digest, r.Size, image.Bytes, r.Revision, payload); err != nil {
		t.Fatal(err)
	}
	if err := checkExistingSchema(d.db); !errors.Is(err, ErrSetupRequired) {
		t.Fatalf("runtime accepted inline schema: %v", err)
	}
	if _, err := d.db.Exec(`CREATE TRIGGER reject_blob_migration BEFORE INSERT ON blob_data BEGIN SELECT RAISE(ABORT,'injected migration failure'); END`); err != nil {
		t.Fatal(err)
	}
	d.Close()
	if alternate, err := SetupDatabase(path, WithBlobStore(&faultBlobs{})); err == nil || !strings.Contains(err.Error(), "default SQLite") {
		if alternate != nil {
			alternate.Close()
		}
		t.Fatalf("inline upgrade accepted an alternate backend: %v", err)
	}
	if failed, err := SetupDatabase(path); err == nil {
		failed.Close()
		t.Fatal("migration ignored storage failure")
	}
	inspection, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	var preserved []byte
	if err := inspection.QueryRow(`SELECT image FROM receipts WHERE id=?`, r.ID).Scan(&preserved); err != nil || !bytes.Equal(preserved, image.Bytes) {
		inspection.Close()
		t.Fatal("failed migration changed inline evidence", err)
	}
	var leftovers int
	if err := inspection.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name='receipts_inline'`).Scan(&leftovers); err != nil || leftovers != 0 {
		inspection.Close()
		t.Fatal("failed migration left a partial table", err)
	}
	if _, err := inspection.Exec(`DROP TRIGGER reject_blob_migration`); err != nil {
		inspection.Close()
		t.Fatal(err)
	}
	inspection.Close()
	for i := 0; i < 2; i++ {
		d, err = SetupDatabase(path)
		if err != nil {
			t.Fatal(err)
		}
		scoped, err := d.Account("migration")
		if err != nil {
			t.Fatal(err)
		}
		got, err := scoped.GetReceiptImage(t.Context(), r.ID)
		if err != nil || !bytes.Equal(got.Bytes, image.Bytes) {
			t.Fatalf("migrated pixels = %+v %v", got, err)
		}
		stored, err := scoped.GetReceipt(r.ID)
		if err != nil || stored.Revision != r.Revision || stored.Confirmed.Merchant != "Preserved correction" {
			t.Fatalf("metadata changed: %+v %v", stored, err)
		}
		after, _ := scoped.LoadDocument()
		afterRevision, _ := DocumentETag(after)
		if beforeRevision != afterRevision {
			t.Fatal("blob migration changed financial identity")
		}
		var count int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM blob_objects`).Scan(&count); err != nil || count != 1 {
			t.Fatalf("migration repeated: %d %v", count, err)
		}
		d.Close()
	}
}

func TestBlobLifecycleSchemaRequiresExplicitRepair(t *testing.T) {
	d := openSharedTestDatabase(t)
	for _, statement := range []string{`DROP TRIGGER receipt_blob_delete`, `DROP INDEX blob_cleanup`, `DROP INDEX receipt_blob_key`} {
		if _, err := d.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
		if err := checkExistingSchema(d.db); !errors.Is(err, ErrSetupRequired) {
			t.Fatalf("incomplete lifecycle schema accepted: %v", err)
		}
		if err := d.setupSchema(); err != nil {
			t.Fatal(err)
		}
	}
}
