package sqlite

const receiptSchema = `CREATE TABLE IF NOT EXISTS receipts (
	account_id TEXT NOT NULL REFERENCES app_accounts(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	posting_id TEXT NOT NULL,
	digest TEXT NOT NULL,
	size INTEGER NOT NULL CHECK(size > 0),
	blob_key TEXT NOT NULL REFERENCES blob_objects(key),
	revision INTEGER NOT NULL,
	payload TEXT NOT NULL,
	PRIMARY KEY(account_id, id),
	UNIQUE(account_id, posting_id, digest),
	FOREIGN KEY(account_id, posting_id) REFERENCES postings(account_id, id) ON DELETE CASCADE
)`

const receiptColumns = "account_id, id, posting_id, digest, size, blob_key, revision, payload"
