package sqlite

const receiptSchema = `CREATE TABLE IF NOT EXISTS receipts (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	transaction_id TEXT NOT NULL,
	digest TEXT NOT NULL,
	size INTEGER NOT NULL CHECK(size > 0),
	blob_key TEXT NOT NULL REFERENCES blob_objects(key),
	revision INTEGER NOT NULL,
	payload TEXT NOT NULL,
	PRIMARY KEY(user_id, id),
	UNIQUE(user_id, transaction_id, digest),
	FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE
)`

const receiptColumns = "user_id, id, transaction_id, digest, size, blob_key, revision, payload"
