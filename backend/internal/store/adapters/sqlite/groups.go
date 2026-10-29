// Package store owns group persistence alongside financial plans.
// Groups are social only. They never gate plan reads or projections.
package sqlite

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func validGroupRole(role string) bool {
	return role == GroupRoleOwner || role == GroupRoleAdmin || role == GroupRoleMember
}

func newGroupID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("generate group id: %w", err)
	}
	return id.String(), nil
}

func newInviteCode() (string, string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generate invite code: %w", err)
	}
	code := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(code))
	return code, hex.EncodeToString(sum[:]), nil
}

func hashInviteCode(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

// EnsureGroupUser records the verified issuer/subject pair and returns
// the stable user ID. It never creates plans. The ID derivation is
// shared with private plans through authorization.ActorKey so one verified
// identity never splits into a plan identity and a group identity.
func (d *Database) EnsureGroupUser(issuer, subject string) (string, error) {
	if issuer == "" || subject == "" {
		return "", fmt.Errorf("%w: group user requires issuer and subject", ErrGroupInvalid)
	}
	userID := authorization.ActorKey(issuer, subject)
	tx, err := d.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO users(id, issuer, subject) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, userID, issuer, subject); err != nil {
		return "", fmt.Errorf("ensure group user: %w", err)
	}
	var storedIssuer, storedSubject string
	if err := tx.QueryRow(`SELECT issuer, subject FROM users WHERE id = ?`, userID).Scan(&storedIssuer, &storedSubject); err != nil {
		return "", err
	}
	if storedIssuer != issuer || storedSubject != subject {
		return "", errors.New("user identity conflict")
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return userID, nil
}

// roleInTx reads one membership role inside a guard transaction. It returns
// "" for non-members without an error so callers map absence to 404.
func roleInTx(tx *sql.Tx, groupID, userID string) (string, error) {
	var role string
	err := tx.QueryRow(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// groupExistsTx reports whether the group row exists, so missing groups map
// to 404 (sql.ErrNoRows) instead of a role denial.
func groupExistsTx(tx *sql.Tx, groupID string) (bool, error) {
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM user_groups WHERE id = ?`, groupID).Scan(&exists); err != nil {
		return false, err
	}
	return exists == 1, nil
}

// CreateGroup creates a group and assigns the caller as owner.
func (d *Database) CreateGroup(userID, name, displayName string) (Group, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return Group{}, fmt.Errorf("%w: group name must be 1-100 characters", ErrGroupInvalid)
	}
	if userID == "" {
		return Group{}, fmt.Errorf("%w: group creator is required", ErrGroupInvalid)
	}
	id, err := newGroupID()
	if err != nil {
		return Group{}, err
	}
	now := time.Now().Unix()
	tx, err := d.db.Begin()
	if err != nil {
		return Group{}, err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, userID).Scan(&exists); err != nil {
		return Group{}, err
	}
	if exists == 0 {
		return Group{}, fmt.Errorf("%w: unknown user", ErrGroupInvalid)
	}
	if _, err := tx.Exec(`INSERT INTO user_groups(id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)`, id, name, userID, now); err != nil {
		return Group{}, fmt.Errorf("create group: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO group_members(group_id, user_id, role, joined_at, display_name) VALUES (?, ?, 'owner', ?, ?)`, id, userID, now, strings.TrimSpace(displayName)); err != nil {
		return Group{}, fmt.Errorf("assign group owner: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Group{}, err
	}
	return Group{ID: id, Name: name, Role: GroupRoleOwner, MemberCount: 1, CreatedAt: now}, nil
}

// ListGroupsForUser returns every group the user belongs to.
func (d *Database) ListGroupsForUser(userID string) ([]Group, error) {
	rows, err := d.db.Query(`
		SELECT g.id, g.name, g.created_at, m.role,
			(SELECT COUNT(*) FROM group_members WHERE group_id = g.id)
		FROM user_groups g
		JOIN group_members m ON m.group_id = g.id AND m.user_id = ?
		ORDER BY g.created_at DESC, g.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.CreatedAt, &g.Role, &g.MemberCount); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func (d *Database) groupRole(groupID, userID string) (string, error) {
	var role string
	err := d.db.QueryRow(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// GetGroup returns group details when the caller is a member.
func (d *Database) GetGroup(groupID, userID string) (Group, error) {
	var g Group
	var role string
	err := d.db.QueryRow(`
		SELECT g.id, g.name, g.created_at, m.role,
			(SELECT COUNT(*) FROM group_members WHERE group_id = g.id)
		FROM user_groups g
		JOIN group_members m ON m.group_id = g.id AND m.user_id = ?
		WHERE g.id = ?`, userID, groupID).Scan(&g.ID, &g.Name, &g.CreatedAt, &role, &g.MemberCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Group{}, ErrNotFound
	}
	if err != nil {
		return Group{}, err
	}
	g.Role = role
	return g, nil
}

// RenameGroup renames a group. Owner and admin may rename.
func (d *Database) RenameGroup(groupID, userID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return fmt.Errorf("%w: group name must be 1-100 characters", ErrGroupInvalid)
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	role, err := roleInTx(tx, groupID, userID)
	if err != nil {
		return err
	}
	if role != GroupRoleOwner && role != GroupRoleAdmin {
		return ErrGroupForbidden
	}
	result, err := tx.Exec(`UPDATE user_groups SET name = ? WHERE id = ?`, name, groupID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// DeleteGroup deletes a group and its members and invites. Owner only.
func (d *Database) DeleteGroup(groupID, userID string) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	role, err := roleInTx(tx, groupID, userID)
	if err != nil {
		return err
	}
	if role != GroupRoleOwner {
		return ErrGroupForbidden
	}
	result, err := tx.Exec(`DELETE FROM user_groups WHERE id = ?`, groupID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// ListGroupMembers lists members when the caller belongs to the group.
func (d *Database) ListGroupMembers(groupID, userID string) ([]GroupMember, error) {
	caller, err := d.groupRole(groupID, userID)
	if err != nil {
		return nil, err
	}
	if caller == "" {
		return nil, ErrNotFound
	}
	rows, err := d.db.Query(`SELECT user_id, role, display_name, joined_at FROM group_members WHERE group_id = ? ORDER BY joined_at ASC, user_id ASC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := []GroupMember{}
	for rows.Next() {
		var m GroupMember
		if err := rows.Scan(&m.AccountID, &m.Role, &m.DisplayName, &m.JoinedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// UpdateMemberRole changes a member role. Owner only. The last owner cannot demote.
// The guard and write run in one transaction so concurrent owners cannot
// leave the group ownerless.
func (d *Database) UpdateMemberRole(groupID, callerID, targetID, role string) error {
	if !validGroupRole(role) {
		return fmt.Errorf("%w: unknown role", ErrGroupInvalid)
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	caller, err := roleInTx(tx, groupID, callerID)
	if err != nil {
		return err
	}
	if caller != GroupRoleOwner {
		return ErrGroupForbidden
	}
	target, err := roleInTx(tx, groupID, targetID)
	if err != nil {
		return err
	}
	if target == "" {
		return ErrNotFound
	}
	if target == GroupRoleOwner && role != GroupRoleOwner {
		var owners int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = ? AND role = 'owner'`, groupID).Scan(&owners); err != nil {
			return err
		}
		if owners <= 1 {
			return fmt.Errorf("%w: the last owner cannot change role", ErrGroupInvalid)
		}
	}
	if _, err := tx.Exec(`UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?`, role, groupID, targetID); err != nil {
		return err
	}
	return tx.Commit()
}

// RemoveMember kicks a member. Owner may kick anyone except the last owner.
// Admin may kick members only. The guard and write run in one transaction.
func (d *Database) RemoveMember(groupID, callerID, targetID string) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	caller, err := roleInTx(tx, groupID, callerID)
	if err != nil {
		return err
	}
	target, err := roleInTx(tx, groupID, targetID)
	if err != nil {
		return err
	}
	if target == "" {
		return ErrNotFound
	}
	switch caller {
	case GroupRoleOwner:
		if target == GroupRoleOwner {
			var owners int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = ? AND role = 'owner'`, groupID).Scan(&owners); err != nil {
				return err
			}
			if owners <= 1 {
				return fmt.Errorf("%w: the last owner cannot be removed", ErrGroupInvalid)
			}
		}
	case GroupRoleAdmin:
		if target != GroupRoleMember {
			return ErrGroupForbidden
		}
	default:
		return ErrGroupForbidden
	}
	if _, err := tx.Exec(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, targetID); err != nil {
		return err
	}
	return tx.Commit()
}

// LeaveGroup removes the caller. The last owner must transfer or delete.
// The guard and write run in one transaction.
func (d *Database) LeaveGroup(groupID, userID string) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	role, err := roleInTx(tx, groupID, userID)
	if err != nil {
		return err
	}
	if role == "" {
		return ErrNotFound
	}
	if role == GroupRoleOwner {
		var owners int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = ? AND role = 'owner'`, groupID).Scan(&owners); err != nil {
			return err
		}
		if owners <= 1 {
			var total int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = ?`, groupID).Scan(&total); err != nil {
				return err
			}
			if total > 1 {
				return fmt.Errorf("%w: transfer ownership before leaving", ErrGroupInvalid)
			}
			// Sole owner leaving deletes the group.
			if _, err := tx.Exec(`DELETE FROM user_groups WHERE id = ?`, groupID); err != nil {
				return err
			}
			return tx.Commit()
		}
	}
	if _, err := tx.Exec(`DELETE FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// CreateInvite creates a redeemable invite. Owner and admin may invite.
// Returns the invite plus the one-time code. The role check and insert run
// in one transaction.
func (d *Database) CreateInvite(groupID, userID string, maxUses int, ttl time.Duration) (GroupInvite, string, error) {
	if maxUses < 1 || maxUses > 100 {
		return GroupInvite{}, "", fmt.Errorf("%w: max uses must be 1-100", ErrGroupInvalid)
	}
	if ttl < time.Minute || ttl > 30*24*time.Hour {
		return GroupInvite{}, "", fmt.Errorf("%w: expiry must be between 1 minute and 30 days", ErrGroupInvalid)
	}
	id, err := newGroupID()
	if err != nil {
		return GroupInvite{}, "", err
	}
	code, codeHash, err := newInviteCode()
	if err != nil {
		return GroupInvite{}, "", err
	}
	now := time.Now().Unix()
	invite := GroupInvite{ID: id, GroupID: groupID, ExpiresAt: now + int64(ttl.Seconds()), MaxUses: maxUses, CreatedAt: now}
	tx, err := d.db.Begin()
	if err != nil {
		return GroupInvite{}, "", err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return GroupInvite{}, "", err
	}
	if !exists {
		return GroupInvite{}, "", ErrNotFound
	}
	role, err := roleInTx(tx, groupID, userID)
	if err != nil {
		return GroupInvite{}, "", err
	}
	if role != GroupRoleOwner && role != GroupRoleAdmin {
		return GroupInvite{}, "", ErrGroupForbidden
	}
	if _, err := tx.Exec(`INSERT INTO group_invites(id, group_id, code_hash, created_by_user_id, expires_at, max_uses, used_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
		id, groupID, codeHash, userID, invite.ExpiresAt, maxUses, now); err != nil {
		return GroupInvite{}, "", fmt.Errorf("create invite: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return GroupInvite{}, "", err
	}
	return invite, code, nil
}

// ListInvites lists active and history invites for owners and admins.
func (d *Database) ListInvites(groupID, userID string) ([]GroupInvite, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	role, err := roleInTx(tx, groupID, userID)
	if err != nil {
		return nil, err
	}
	// Non-members learn nothing: missing and foreign groups both read 404.
	// Members without the owner/admin privilege are denied with 403.
	if role == "" {
		return nil, ErrNotFound
	}
	if role != GroupRoleOwner && role != GroupRoleAdmin {
		return nil, ErrGroupForbidden
	}
	rows, err := tx.Query(`SELECT id, group_id, expires_at, max_uses, used_count, revoked_at, created_at FROM group_invites WHERE group_id = ? ORDER BY created_at DESC, id DESC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	invites := []GroupInvite{}
	for rows.Next() {
		var in GroupInvite
		var revoked sql.NullInt64
		if err := rows.Scan(&in.ID, &in.GroupID, &in.ExpiresAt, &in.MaxUses, &in.UsedCount, &revoked, &in.CreatedAt); err != nil {
			return nil, err
		}
		if revoked.Valid {
			value := revoked.Int64
			in.RevokedAt = &value
		}
		invites = append(invites, in)
	}
	return invites, rows.Err()
}

// RevokeInvite cancels an invite. Owner and admin may revoke. The role
// check and update run in one transaction.
func (d *Database) RevokeInvite(groupID, inviteID, userID string) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	exists, err := groupExistsTx(tx, groupID)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	role, err := roleInTx(tx, groupID, userID)
	if err != nil {
		return err
	}
	if role != GroupRoleOwner && role != GroupRoleAdmin {
		return ErrGroupForbidden
	}
	result, err := tx.Exec(`UPDATE group_invites SET revoked_at = ? WHERE id = ? AND group_id = ? AND revoked_at IS NULL`, time.Now().Unix(), inviteID, groupID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// AcceptInvite redeems a code. Any authenticated user may accept.
func (d *Database) AcceptInvite(code, userID, displayName string) (Group, error) {
	code = strings.TrimSpace(code)
	if code == "" || userID == "" {
		return Group{}, fmt.Errorf("%w: invite code and user are required", ErrGroupInvalid)
	}
	codeHash := hashInviteCode(code)
	now := time.Now().Unix()
	tx, err := d.db.Begin()
	if err != nil {
		return Group{}, err
	}
	defer tx.Rollback()
	var invite GroupInvite
	var revoked sql.NullInt64
	err = tx.QueryRow(`SELECT id, group_id, expires_at, max_uses, used_count, revoked_at FROM group_invites WHERE code_hash = ?`, codeHash).
		Scan(&invite.ID, &invite.GroupID, &invite.ExpiresAt, &invite.MaxUses, &invite.UsedCount, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return Group{}, ErrNotFound
	}
	if err != nil {
		return Group{}, err
	}
	if revoked.Valid || invite.ExpiresAt <= now || invite.UsedCount >= invite.MaxUses {
		return Group{}, fmt.Errorf("%w: invite is no longer valid", ErrGroupInvalid)
	}
	var existing string
	err = tx.QueryRow(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`, invite.GroupID, userID).Scan(&existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Group{}, err
	}
	if existing != "" {
		return Group{}, fmt.Errorf("%w: already a member", ErrGroupInvalid)
	}
	if _, err := tx.Exec(`INSERT INTO group_members(group_id, user_id, role, joined_at, display_name) VALUES (?, ?, 'member', ?, ?)`, invite.GroupID, userID, now, strings.TrimSpace(displayName)); err != nil {
		return Group{}, fmt.Errorf("join group: %w", err)
	}
	if _, err := tx.Exec(`UPDATE group_invites SET used_count = used_count + 1 WHERE id = ?`, invite.ID); err != nil {
		return Group{}, err
	}
	var g Group
	err = tx.QueryRow(`SELECT id, name, created_at, (SELECT COUNT(*) FROM group_members WHERE group_id = ?) FROM user_groups WHERE id = ?`, invite.GroupID, invite.GroupID).
		Scan(&g.ID, &g.Name, &g.CreatedAt, &g.MemberCount)
	if err != nil {
		return Group{}, err
	}
	g.Role = GroupRoleMember
	if err := tx.Commit(); err != nil {
		return Group{}, err
	}
	return g, nil
}

// TouchMemberDisplay refreshes the cached display name on activity. It is
// best-effort across every group the user belongs to, so errors stay
// silent and never fail the surrounding request.
func (d *Database) TouchMemberDisplay(userID, displayName string) {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" || userID == "" {
		return
	}
	_, _ = d.db.Exec(`UPDATE group_members SET display_name = ? WHERE user_id = ? AND (display_name IS NULL OR display_name = '' OR display_name != ?)`, displayName, userID, displayName)
}

// RemoveGroupMembershipsForUser removes every group membership after
// confirmed provider user deletion. Groups left with no members are
// deleted, and surviving invites created by the user are revoked so no
// outstanding code stays redeemable. It preserves users and private
// plans.
func (d *Database) RemoveGroupMembershipsForUser(userID string) error {
	if userID == "" {
		return fmt.Errorf("%w: user is required", ErrGroupInvalid)
	}
	return DeleteGroupMemberships(d.db, userID)
}

// DeleteGroupMemberships is the shared user-removal path for Database and
// the identity revocation path, which holds only a *sql.DB handle. Databases
// without group tables are tolerated so old schemas fail nowhere on logout
// or revocation.
func DeleteGroupMemberships(db *sql.DB, userID string) error {
	if userID == "" {
		return fmt.Errorf("%w: user is required", ErrGroupInvalid)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Capture the user's groups first so cleanup below touches only
	// groups this user belonged to, never unrelated rows.
	rows, err := tx.Query(`SELECT DISTINCT group_id FROM group_members WHERE user_id = ?`, userID)
	if err != nil {
		if isMissingGroupTable(err) {
			return nil
		}
		return err
	}
	var owned []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		owned = append(owned, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if _, err := tx.Exec(`DELETE FROM group_members WHERE user_id = ?`, userID); err != nil {
		return err
	}
	if len(owned) > 0 {
		placeholders := strings.Repeat("?,", len(owned)-1) + "?"
		args := make([]any, 0, len(owned))
		for _, id := range owned {
			args = append(args, id)
		}
		// Groups left with no members are deleted, like LeaveGroup does for
		// a sole owner; their invites cascade. Scoped to this user's
		// former groups only.
		if _, err := tx.Exec(`DELETE FROM user_groups WHERE id IN (`+placeholders+`) AND id NOT IN (SELECT group_id FROM group_members)`, args...); err != nil {
			return err
		}
	}
	// Revoke, rather than delete, surviving invites the user created so
	// remaining members keep invite history and no code stays redeemable.
	if _, err := tx.Exec(`UPDATE group_invites SET revoked_at = ? WHERE created_by_user_id = ? AND revoked_at IS NULL`, time.Now().Unix(), userID); err != nil {
		return err
	}
	return tx.Commit()
}

func isMissingGroupTable(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such table: group_members") ||
		strings.Contains(err.Error(), "no such table: user_groups") ||
		strings.Contains(err.Error(), "no such table: group_invites")
}
