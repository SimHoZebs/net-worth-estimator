// Package store owns friend persistence alongside financial plans and
// groups. Friendships are social only. They never gate plan reads,
// projections, or financial writes: friendship alone grants no financial
// data access. A later share layer must check AreFriends before sending
// and must refuse removed or blocked recipients; that enforcement does
// not live here.
package sqlite

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// escapeFriendSearch escapes LIKE metacharacters so a search string only
// matches its literal text.
func escapeFriendSearch(query string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(query)
}

// ListFriends returns the caller's accepted friends, newest first. A
// non-empty search filters to display names containing the literal query,
// case-insensitively. Names are non-unique; duplicates stay visible and
// distinguishable only by their stable user ID.
func (d *Database) ListFriends(userID, search string) ([]Friend, error) {
	if userID == "" {
		return nil, errors.New("friends require a user")
	}
	search = strings.TrimSpace(search)
	query := `SELECT friend_user_id, display_name, created_at FROM friendships WHERE user_id = ?`
	args := []any{userID}
	if search != "" {
		query += ` AND display_name LIKE '%' || ? || '%' ESCAPE '\' COLLATE NOCASE`
		args = append(args, escapeFriendSearch(search))
	}
	query += ` ORDER BY created_at DESC, friend_user_id DESC`
	found, err := d.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer found.Close()
	friends := []Friend{}
	for found.Next() {
		var f Friend
		if err := found.Scan(&f.AccountID, &f.DisplayName, &f.CreatedAt); err != nil {
			return nil, err
		}
		friends = append(friends, f)
	}
	return friends, found.Err()
}

// GetFriend returns one accepted friend. Unknown users and non-friends
// both report ErrNotFound so friendships are not enumerable.
func (d *Database) GetFriend(userID, friendID string) (Friend, error) {
	if userID == "" || friendID == "" {
		return Friend{}, store.ErrNotFound
	}
	var f Friend
	err := d.db.QueryRow(`SELECT friend_user_id, display_name, created_at FROM friendships WHERE user_id = ? AND friend_user_id = ?`,
		userID, friendID).Scan(&f.AccountID, &f.DisplayName, &f.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Friend{}, store.ErrNotFound
	}
	if err != nil {
		return Friend{}, err
	}
	return f, nil
}

// AreFriends reports whether userID lists friendID as an accepted friend.
// Share layers use this as the refusal seam: a false result must deny new
// friend-only shares. It reads one directed edge and never financial data.
func (d *Database) AreFriends(userID, friendID string) (bool, error) {
	if userID == "" || friendID == "" {
		return false, nil
	}
	var exists int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_user_id = ?`,
		userID, friendID).Scan(&exists); err != nil {
		return false, err
	}
	return exists == 1, nil
}

// TouchFriendDisplay refreshes the cached display name on activity. It is
// best-effort across every friendship pointing at the user, so errors stay
// silent and never fail the surrounding request.
func (d *Database) TouchFriendDisplay(userID, displayName string) {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || userID == "" {
		return
	}
	_, _ = d.db.Exec(`UPDATE friendships SET display_name = ? WHERE friend_user_id = ? AND (display_name IS NULL OR display_name = '' OR display_name != ?)`,
		displayName, userID, displayName)
}
