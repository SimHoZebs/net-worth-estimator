package sqlite

const receiptSchema = `CREATE TABLE IF NOT EXISTS receipts (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	posting_id TEXT NOT NULL,
	digest TEXT NOT NULL,
	size INTEGER NOT NULL CHECK(size > 0),
	blob_key TEXT NOT NULL REFERENCES blob_objects(key),
	revision INTEGER NOT NULL,
	payload TEXT NOT NULL,
	PRIMARY KEY(user_id, id),
	UNIQUE(user_id, posting_id, digest),
	FOREIGN KEY(user_id, posting_id) REFERENCES postings(user_id, id) ON DELETE CASCADE
)`

const receiptColumns = "user_id, id, posting_id, digest, size, blob_key, revision, payload"
