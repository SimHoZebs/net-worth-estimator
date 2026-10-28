package sqlite

const receiptSchema = `CREATE TABLE IF NOT EXISTS receipts (
	plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	posting_id TEXT NOT NULL,
	digest TEXT NOT NULL,
	size INTEGER NOT NULL CHECK(size > 0),
	blob_key TEXT NOT NULL REFERENCES blob_objects(key),
	revision INTEGER NOT NULL,
	payload TEXT NOT NULL,
	PRIMARY KEY(plan_id, id),
	UNIQUE(plan_id, posting_id, digest),
	FOREIGN KEY(plan_id, posting_id) REFERENCES postings(plan_id, id) ON DELETE CASCADE
)`

const receiptColumns = "plan_id, id, posting_id, digest, size, blob_key, revision, payload"
