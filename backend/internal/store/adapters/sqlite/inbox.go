// Received-share inbox state (FND-03). Inbox rows record the
// recipient's own decision, read, and dismissed state for shares that
// arrive through FND-02 grants. They never authorize: listing derives
// candidates from ListSharedPostings and re-checks every preview through
// CheckSharedPostingAccess, and canceled items (previously seen shares
// that lost authorization) carry no transaction content.
//
// Decisions lean final: a recorded acceptance never reverts, so decline
// after accept returns the accepted item unchanged. Acceptance may follow
// a decline while the share stays authorized (group-audience shares keep
// their grant); a declined direct share withdrew its grant, so accepting
// afterwards reports not-found until the sender shares again. A fresh
// grant after a decline is a new sender decision: listing re-opens the
// share as pending unread, while standing grants never reset it.
package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// inboxSchemaStatements creates per-recipient inbox state. One row is one
// recipient's relationship to one owner-scoped posting: decision status,
// read and dismissed flags, sighting timestamps, and the accepted copy's
// ID for retry adoption. Rows are recipient-owned and vanish with the
// recipient; they never grant access to anyone.
func inboxSchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS inbox_share_state (
			recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			owner_user_id TEXT NOT NULL,
			posting_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
			unread INTEGER NOT NULL DEFAULT 1 CHECK (unread IN (0, 1)),
			dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
			received_at INTEGER NOT NULL,
			decided_at INTEGER NOT NULL DEFAULT 0,
			copy_posting_id TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (recipient_user_id, owner_user_id, posting_id)
		)`,
		`CREATE INDEX IF NOT EXISTS inbox_share_state_recipient ON inbox_share_state(recipient_user_id, unread, dismissed)`,
	}
}

// WithdrawUserGrant deletes a direct user-audience grant addressed to the
// recipient themselves. It is the recipient's refusal path, not an owner
// revocation: grants addressed to anyone else and group-audience grants
// are never touched.
func (d *Database) WithdrawUserGrant(recipientID, ownerID, postingID string) error {
	if !validSharingUserID(recipientID) || !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return fmt.Errorf("%w: recipient, owner and posting must identify one share", store.ErrGroupInvalid)
	}
	result, err := d.db.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, recipientID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

// senderDisplayName resolves the sender's display name only through groups
// the recipient currently shares with the sender, where the name is
// already visible on the member list. Otherwise it reports "", and the
// item carries no name.
func senderDisplayName(db *sql.DB, recipientID, ownerID string) (string, error) {
	var name string
	err := db.QueryRow(`SELECT m2.display_name FROM group_members m1 JOIN group_members m2 ON m1.group_id = m2.group_id
		WHERE m1.user_id = ? AND m2.user_id = ? AND m2.display_name <> '' LIMIT 1`, recipientID, ownerID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return name, err
}

type inboxStateRow struct {
	status      string
	unread      bool
	dismissed   bool
	receivedAt  int64
	decidedAt   int64
	copyPosting string
	present     bool
}

// inboxQuerier covers single-statement state reads against the pool or
// an open transaction; both share the QueryRow shape.
type inboxQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func readInboxState(q inboxQuerier, recipientID, ownerID, postingID string) (inboxStateRow, error) {
	var row inboxStateRow
	var unread, dismissed int
	var copyPosting string
	err := q.QueryRow(`SELECT status, unread, dismissed, received_at, decided_at, copy_posting_id FROM inbox_share_state
		WHERE recipient_user_id = ? AND owner_user_id = ? AND posting_id = ?`, recipientID, ownerID, postingID).
		Scan(&row.status, &unread, &dismissed, &row.receivedAt, &row.decidedAt, &copyPosting)
	if errors.Is(err, sql.ErrNoRows) {
		return inboxStateRow{status: store.InboxStatusPending, unread: true}, nil
	}
	if err != nil {
		return inboxStateRow{}, err
	}
	row.present = true
	row.unread = unread == 1
	row.dismissed = dismissed == 1
	row.copyPosting = copyPosting
	return row, nil
}

// recordInboxSighting upserts the sighting row for a currently authorized
// share. First sighting stamps receipt and starts unread; later sightings
// never overwrite the recipient's decision, read, or dismissed state.
func recordInboxSighting(tx *sql.Tx, recipientID, ownerID, postingID string, now int64) error {
	_, err := tx.Exec(`INSERT INTO inbox_share_state(recipient_user_id, owner_user_id, posting_id, status, unread, dismissed, received_at)
		VALUES (?, ?, ?, 'pending', 1, 0, ?) ON CONFLICT(recipient_user_id, owner_user_id, posting_id) DO NOTHING`,
		recipientID, ownerID, postingID, now)
	return err
}

// freshAuthorizingGrant reports whether a grant that currently authorizes
// the recipient is newer than the recipient's decision. A fresh grant is
// a new sender decision: it re-opens a declined share as pending.
//
// A current direct grant always post-dates a recorded decline, because
// declining deletes it — no timestamp comparison needed. Group grants
// stand through a decline, so only one created after the decision counts;
// standing grants never reset a recorded decline, keeping group-share
// refusals stable across lists.
func (d *Database) freshAuthorizingGrant(ownerID, postingID, recipientID string, since int64) (bool, error) {
	var direct int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ?
		AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`, ownerID, postingID, recipientID).Scan(&direct); err != nil {
		return false, err
	}
	if direct > 0 {
		return true, nil
	}
	rows, err := d.db.Query(`SELECT audience_id FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ?
		AND audience_type = 'group' AND intent = 'shared' AND created_at > ?`, ownerID, postingID, since)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	var groups []string
	for rows.Next() {
		var groupID string
		if err := rows.Scan(&groupID); err != nil {
			return false, err
		}
		groups = append(groups, groupID)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	for _, groupID := range groups {
		recipientRole, err := d.groupRole(groupID, recipientID)
		if err != nil {
			return false, err
		}
		if recipientRole == "" {
			continue
		}
		ownerRole, err := d.groupRole(groupID, ownerID)
		if err != nil {
			return false, err
		}
		if ownerRole != "" {
			return true, nil
		}
	}
	return false, nil
}

// reopenDeclined resets a declined share to pending unread when a fresh
// grant re-authorizes it. The reset is conditional on the row still being
// declined, so a concurrent decision wins over a stale list.
func reopenDeclined(tx *sql.Tx, recipientID, ownerID, postingID string, now int64) error {
	_, err := tx.Exec(`UPDATE inbox_share_state SET status = 'pending', unread = 1, dismissed = 0, received_at = ?, decided_at = 0
		WHERE recipient_user_id = ? AND owner_user_id = ? AND posting_id = ? AND status = 'declined'`,
		now, recipientID, ownerID, postingID)
	return err
}

// inboxItem assembles one item from a state row and current authorization.
// Unauthorized items carry no preview; decided items keep their decision;
// undecided unauthorized-but-seen items report canceled.
func (d *Database) inboxItem(recipientID, ownerID, postingID string, state inboxStateRow) (store.InboxShareItem, error) {
	item := store.InboxShareItem{
		Kind:          store.InboxKindShare,
		OwnerUserID:   ownerID,
		PostingID:     postingID,
		Status:        state.status,
		Unread:        state.unread,
		Dismissed:     state.dismissed,
		ReceivedAt:    state.receivedAt,
		DecidedAt:     state.decidedAt,
		CopyPostingID: state.copyPosting,
	}
	name, err := senderDisplayName(d.db, recipientID, ownerID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	item.SenderDisplayName = name
	access, err := d.CheckSharedPostingAccess(ownerID, postingID, recipientID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if !access.Allowed {
		if state.present && state.status == store.InboxStatusPending {
			item.Status = store.InboxStatusCanceled
		}
		return item, nil
	}
	posting, err := d.ReadSharedPosting(ownerID, postingID, recipientID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			if state.present && state.status == store.InboxStatusPending {
				item.Status = store.InboxStatusCanceled
			}
			return item, nil
		}
		return store.InboxShareItem{}, err
	}
	item.Posting = &posting
	return item, nil
}

func validInboxShare(recipientID, ownerID, postingID string) error {
	if !validSharingUserID(recipientID) || !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return fmt.Errorf("%w: recipient, owner and posting must identify one share", store.ErrGroupInvalid)
	}
	return nil
}

// ListInboxItems returns the recipient's received-share inbox. Currently
// authorized shares (from the ListSharedPostings primitive) record a
// sighting and appear with their preview; state rows for shares that lost
// authorization appear as canceled without content when undecided, and
// keep their recorded decision otherwise.
func (d *Database) ListInboxItems(recipientID string) ([]store.InboxShareItem, error) {
	if !validSharingUserID(recipientID) {
		return nil, fmt.Errorf("%w: recipient must be a user ID", store.ErrGroupInvalid)
	}
	refs, err := d.ListSharedPostings(recipientID)
	if err != nil {
		return nil, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	type shareKey struct{ owner, posting string }
	seen := map[shareKey]bool{}
	var order []shareKey
	add := func(owner, posting string) {
		k := shareKey{owner, posting}
		if !seen[k] {
			seen[k] = true
			order = append(order, k)
		}
	}
	for _, ref := range refs {
		if err := recordInboxSighting(tx, recipientID, ref.OwnerUserID, ref.Posting.ID, now); err != nil {
			return nil, err
		}
		add(ref.OwnerUserID, ref.Posting.ID)
	}
	rows, err := tx.Query(`SELECT owner_user_id, posting_id FROM inbox_share_state WHERE recipient_user_id = ? ORDER BY received_at DESC, owner_user_id, posting_id`, recipientID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var owner, posting string
		if err := rows.Scan(&owner, &posting); err != nil {
			rows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	items := []store.InboxShareItem{}
	for _, k := range order {
		state, err := readInboxState(d.db, recipientID, k.owner, k.posting)
		if err != nil {
			return nil, err
		}
		// A fresh grant after a decline is a new sender decision: the
		// share returns to pending unread. Authorization resolves before
		// the reset transaction opens; the reset itself stays conditional
		// so a concurrent decision is never overwritten.
		if state.present && state.status == store.InboxStatusDeclined {
			fresh, err := d.freshAuthorizingGrant(k.owner, k.posting, recipientID, state.decidedAt)
			if err != nil {
				return nil, err
			}
			if fresh {
				tx, err := d.db.Begin()
				if err != nil {
					return nil, err
				}
				if err := reopenDeclined(tx, recipientID, k.owner, k.posting, now); err != nil {
					_ = tx.Rollback()
					return nil, err
				}
				if err := tx.Commit(); err != nil {
					return nil, err
				}
				if state, err = readInboxState(d.db, recipientID, k.owner, k.posting); err != nil {
					return nil, err
				}
			}
		}
		item, err := d.inboxItem(recipientID, k.owner, k.posting, state)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// writeInboxState upserts decision/read/dismissed fields, preserving every
// field the caller does not set and stamping receipt on first insert.
func writeInboxState(tx *sql.Tx, recipientID, ownerID, postingID string, now int64, mutate func(*inboxStateRow)) error {
	state, err := readInboxState(tx, recipientID, ownerID, postingID)
	if err != nil {
		return err
	}
	if !state.present {
		state.receivedAt = now
	}
	mutate(&state)
	unread, dismissed := 0, 0
	if state.unread {
		unread = 1
	}
	if state.dismissed {
		dismissed = 1
	}
	_, err = tx.Exec(`INSERT INTO inbox_share_state(recipient_user_id, owner_user_id, posting_id, status, unread, dismissed, received_at, decided_at, copy_posting_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(recipient_user_id, owner_user_id, posting_id) DO UPDATE SET status = excluded.status, unread = excluded.unread,
		dismissed = excluded.dismissed, decided_at = excluded.decided_at, copy_posting_id = excluded.copy_posting_id`,
		recipientID, ownerID, postingID, state.status, unread, dismissed, state.receivedAt, state.decidedAt, state.copyPosting)
	return err
}

// existingCopyForSource finds a recipient-owned copy of one source share
// through copy provenance, so retried accepts adopt instead of duplicating.
func existingCopyForSource(db *sql.DB, recipientID, ownerID, postingID string) (string, error) {
	var copyID string
	err := db.QueryRow(`SELECT c.copy_posting_id FROM sharing_copies c JOIN postings p ON p.user_id = c.recipient_user_id AND p.id = c.copy_posting_id
		WHERE c.recipient_user_id = ? AND c.source_owner_id = ? AND c.source_posting_id = ? LIMIT 1`,
		recipientID, ownerID, postingID).Scan(&copyID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return copyID, err
}

// loadInboxItem assembles one item; every mutation resolves through it so
// previews always reflect current authorization.
func (d *Database) loadInboxItem(recipientID, ownerID, postingID string) (store.InboxShareItem, error) {
	state, err := readInboxState(d.db, recipientID, ownerID, postingID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	return d.inboxItem(recipientID, ownerID, postingID, state)
}

// AcceptInboxShare records acceptance and saves one personal copy. Retry
// safety comes from the state row, not the caller: a decided share returns
// its recorded item, and a copy minted by an earlier attempt (or through
// the shared-copies path) is adopted instead of duplicated.
//
// Concurrent accepts serialize on the state write: the loser finds its
// copy orphaned and removes it, so double submission converges on one
// copy. Sequential retries never mint twice. A concurrent decline racing
// an accept resolves last-writer-wins; sequential decisions keep the
// documented precedence instead.
func (d *Database) AcceptInboxShare(recipientID, ownerID, postingID string) (store.InboxShareItem, error) {
	if err := validInboxShare(recipientID, ownerID, postingID); err != nil {
		return store.InboxShareItem{}, err
	}
	state, err := readInboxState(d.db, recipientID, ownerID, postingID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if state.present && state.status == store.InboxStatusAccepted {
		return d.loadInboxItem(recipientID, ownerID, postingID)
	}
	access, err := d.CheckSharedPostingAccess(ownerID, postingID, recipientID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if !access.Allowed {
		return store.InboxShareItem{}, store.ErrNotFound
	}
	copyID, minted := state.copyPosting, false
	if copyID == "" {
		if copyID, err = existingCopyForSource(d.db, recipientID, ownerID, postingID); err != nil {
			return store.InboxShareItem{}, err
		}
	}
	if copyID == "" {
		// The inbox accept path carries no client request key (the HTTP
		// inbox routes take none), so each accept executes under a fresh
		// server key. Triple-dedup still converges concurrent accepts on
		// one copy with one audit row.
		copied, err := d.CopySharedPosting(ownerID, postingID, recipientID, uuid.NewString())
		if err != nil {
			return store.InboxShareItem{}, err
		}
		copyID, minted = copied.ID, true
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.InboxShareItem{}, err
	}
	defer tx.Rollback()
	// Pool queries must not run while this method holds the transaction:
	// the losing copy below deletes only after commit.
	decided, err := readInboxState(tx, recipientID, ownerID, postingID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if decided.present && decided.status == store.InboxStatusAccepted && decided.copyPosting != copyID {
		if err := tx.Commit(); err != nil {
			return store.InboxShareItem{}, err
		}
		if minted {
			// Another accept won the race with its own copy: ours is an
			// orphan. Its provenance clears with it, and the recorded
			// item stays correct, so cleanup failure still converges on
			// retry instead of failing a recorded acceptance.
			recipient := &sqliteStore{db: &userDB{DB: d.db, userID: recipientID}, application: d}
			_ = recipient.DeletePosting(copyID)
		}
		return d.loadInboxItem(recipientID, ownerID, postingID)
	}
	now := time.Now().Unix()
	if err := writeInboxState(tx, recipientID, ownerID, postingID, now, func(s *inboxStateRow) {
		s.status = store.InboxStatusAccepted
		s.decidedAt = now
		s.copyPosting = copyID
	}); err != nil {
		return store.InboxShareItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.InboxShareItem{}, err
	}
	return d.loadInboxItem(recipientID, ownerID, postingID)
}

// DeclineInboxShare records the refusal and withdraws the recipient's own
// direct grant when one addresses them, so they leave the sender's sharing
// list. Group-audience shares keep their grant: the refusal stays
// recipient-local because the audience belongs to the whole group.
func (d *Database) DeclineInboxShare(recipientID, ownerID, postingID string) (store.InboxShareItem, error) {
	if err := validInboxShare(recipientID, ownerID, postingID); err != nil {
		return store.InboxShareItem{}, err
	}
	state, err := readInboxState(d.db, recipientID, ownerID, postingID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if state.present && state.status != store.InboxStatusPending {
		return d.loadInboxItem(recipientID, ownerID, postingID)
	}
	access, err := d.CheckSharedPostingAccess(ownerID, postingID, recipientID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if !access.Allowed && !state.present {
		return store.InboxShareItem{}, store.ErrNotFound
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.InboxShareItem{}, err
	}
	defer tx.Rollback()
	// A concurrent accept may have recorded first: its copy stands and
	// the refusal becomes a no-op, including the withdrawal, so an
	// accepted share never lands back on the sender's list by accident.
	decided, err := readInboxState(tx, recipientID, ownerID, postingID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if decided.present && decided.status == store.InboxStatusAccepted {
		if err := tx.Commit(); err != nil {
			return store.InboxShareItem{}, err
		}
		return d.loadInboxItem(recipientID, ownerID, postingID)
	}
	// Withdrawing a direct grant the recipient never had (group-only
	// shares) is a no-op, not an error: the local refusal still records.
	// Any other withdrawal failure aborts before recording, so a recorded
	// decline of a direct share always matches the sender's list.
	if _, err := tx.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, recipientID); err != nil {
		return store.InboxShareItem{}, err
	}
	now := time.Now().Unix()
	if err := writeInboxState(tx, recipientID, ownerID, postingID, now, func(s *inboxStateRow) {
		s.status = store.InboxStatusDeclined
		s.decidedAt = now
	}); err != nil {
		return store.InboxShareItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.InboxShareItem{}, err
	}
	return d.loadInboxItem(recipientID, ownerID, postingID)
}

// SetInboxShareDismissed hides or unhides an item without changing its
// decision state. Dismissing an unseen share first records its sighting
// only when the share is currently authorized.
func (d *Database) SetInboxShareDismissed(recipientID, ownerID, postingID string, dismissed bool) (store.InboxShareItem, error) {
	return d.setInboxFlag(recipientID, ownerID, postingID, func(s *inboxStateRow) { s.dismissed = dismissed })
}

// SetInboxShareRead marks an item read or unread. Nothing else clears
// unread state: listing, viewing, and deciding leave it untouched.
func (d *Database) SetInboxShareRead(recipientID, ownerID, postingID string, read bool) (store.InboxShareItem, error) {
	return d.setInboxFlag(recipientID, ownerID, postingID, func(s *inboxStateRow) { s.unread = !read })
}

func (d *Database) setInboxFlag(recipientID, ownerID, postingID string, mutate func(*inboxStateRow)) (store.InboxShareItem, error) {
	if err := validInboxShare(recipientID, ownerID, postingID); err != nil {
		return store.InboxShareItem{}, err
	}
	// Authorization resolves before the write transaction opens: pool
	// queries must never run while this method holds a transaction.
	state, err := readInboxState(d.db, recipientID, ownerID, postingID)
	if err != nil {
		return store.InboxShareItem{}, err
	}
	if !state.present {
		access, err := d.CheckSharedPostingAccess(ownerID, postingID, recipientID)
		if err != nil {
			return store.InboxShareItem{}, err
		}
		if !access.Allowed {
			return store.InboxShareItem{}, store.ErrNotFound
		}
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.InboxShareItem{}, err
	}
	defer tx.Rollback()
	if !state.present {
		if err := recordInboxSighting(tx, recipientID, ownerID, postingID, time.Now().Unix()); err != nil {
			return store.InboxShareItem{}, err
		}
	}
	if err := writeInboxState(tx, recipientID, ownerID, postingID, time.Now().Unix(), mutate); err != nil {
		return store.InboxShareItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.InboxShareItem{}, err
	}
	return d.loadInboxItem(recipientID, ownerID, postingID)
}
