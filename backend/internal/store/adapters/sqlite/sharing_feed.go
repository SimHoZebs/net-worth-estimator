// Group shared transaction feed (GRP-03). The feed lists each posting the
// requester is currently authorized to read that belongs in one group,
// exactly once however many group grants, policies, accounts, or direct
// shares match. Candidates come from the indexed references plus the
// explicit manual grants; every candidate passes CheckSharedPostingAccess
// before it is read, so a stale or missing reference under-shares a list
// but never over-shares a read. Filters stay navigation-only: they narrow
// the authorized set for display and never widen eligibility.
package sqlite

import (
	"database/sql"
	"errors"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// ListGroupSharedFeed returns the per-group shared transaction feed: every
// posting the requester is currently authorized to read that belongs in
// the named group. A posting belongs in the group feed when the viewer
// reaches it through the group (a manual group grant or an automatic
// policy naming that group) or through a direct share from one of the
// group's current members. Non-members and unknown groups report
// ErrNotFound so group visibility is not enumerable. Results order by
// owner then posting; keyset feed pagination over the result belongs to
// the HTTP consumer.
func (d *Database) ListGroupSharedFeed(requesterID, groupID string) ([]store.GroupFeedItem, error) {
	if !validSharingUserID(requesterID) || !validSharingGroupID(groupID) {
		return nil, store.ErrNotFound
	}
	role, err := d.groupRole(groupID, requesterID)
	if err != nil {
		return nil, err
	}
	if role == "" {
		return nil, store.ErrNotFound
	}
	type candidate struct{ owner, posting string }
	seen := map[candidate]bool{}
	var candidates []candidate
	add := func(owner, posting string) {
		if owner == requesterID {
			return
		}
		key := candidate{owner, posting}
		if !seen[key] {
			seen[key] = true
			candidates = append(candidates, key)
		}
	}
	// Manual group grants naming this group. The join requires the owner
	// row to still exist; the read gate below re-validates membership,
	// exclusions, and revocation on every call.
	grantRows, err := d.db.Query(`SELECT DISTINCT g.owner_user_id, g.posting_id FROM sharing_grants g
		JOIN postings p ON p.user_id = g.owner_user_id AND p.id = g.posting_id
		WHERE g.audience_type = 'group' AND g.audience_id = ? AND g.intent = 'shared'
		ORDER BY g.owner_user_id, g.posting_id`, groupID)
	if err != nil {
		return nil, err
	}
	for grantRows.Next() {
		var owner, posting string
		if err := grantRows.Scan(&owner, &posting); err != nil {
			grantRows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := grantRows.Err(); err != nil {
		grantRows.Close()
		return nil, err
	}
	grantRows.Close()
	// Automatic candidates: the write-maintained reference index for this
	// group at the current policy version. The joins pre-fence stale rows
	// (version match, current membership both sides, non-void existence);
	// the gate below still decides every read.
	indexRows, err := d.db.Query(`SELECT DISTINCT v.owner_user_id, v.posting_id FROM sharing_visibility v
		JOIN group_members requester ON requester.group_id = v.group_id AND requester.user_id = ?
		JOIN group_members owner ON owner.group_id = v.group_id AND owner.user_id = v.owner_user_id
		JOIN sharing_policies policy ON policy.owner_user_id = v.owner_user_id AND policy.group_id = v.group_id
			AND policy.version = v.policy_version AND policy.enabled = 1
		JOIN postings posting ON posting.user_id = v.owner_user_id AND posting.id = v.posting_id AND posting.void = 0
		WHERE v.group_id = ? AND v.owner_user_id != ? ORDER BY v.owner_user_id, v.posting_id`, requesterID, groupID, requesterID)
	if err != nil {
		return nil, err
	}
	for indexRows.Next() {
		var owner, posting string
		if err := indexRows.Scan(&owner, &posting); err != nil {
			indexRows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := indexRows.Err(); err != nil {
		indexRows.Close()
		return nil, err
	}
	indexRows.Close()
	// Direct shares from the group's current members surface in the group
	// they share with the viewer; a direct share from outside the group
	// belongs to no group feed.
	directRows, err := d.db.Query(`SELECT DISTINCT g.owner_user_id, g.posting_id FROM sharing_grants g
		JOIN postings p ON p.user_id = g.owner_user_id AND p.id = g.posting_id
		JOIN group_members m ON m.group_id = ? AND m.user_id = g.owner_user_id
		WHERE g.audience_type = 'user' AND g.audience_id = ? AND g.intent = 'shared'
		ORDER BY g.owner_user_id, g.posting_id`, groupID, requesterID)
	if err != nil {
		return nil, err
	}
	for directRows.Next() {
		var owner, posting string
		if err := directRows.Scan(&owner, &posting); err != nil {
			directRows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := directRows.Err(); err != nil {
		directRows.Close()
		return nil, err
	}
	directRows.Close()
	items := []store.GroupFeedItem{}
	for _, key := range candidates {
		access, err := d.CheckSharedPostingAccess(key.owner, key.posting, requesterID)
		if err != nil {
			return nil, err
		}
		if !access.Allowed {
			continue
		}
		posting, err := d.ReadSharedPosting(key.owner, key.posting, requesterID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				continue
			}
			return nil, err
		}
		audiences, inGroup, err := d.feedAudiences(groupID, key.owner, key.posting, posting, requesterID)
		if err != nil {
			return nil, err
		}
		if !inGroup {
			continue
		}
		display, err := d.feedDisplayName(groupID, key.owner)
		if err != nil {
			return nil, err
		}
		items = append(items, store.GroupFeedItem{
			OwnerUserID: key.owner, SourceDisplayName: display,
			Audiences: audiences, Posting: posting,
		})
	}
	return items, nil
}

// feedAudiences attributes the viewer's authorizing paths for one gated
// posting: every group the viewer reaches it through (manual grant or
// automatic policy, named by current group name) plus a direct-share entry
// when a manual grant names the viewer. It reports whether the posting
// belongs in the named group feed: through that group, or directly from
// one of its current members. Every path mirrors the live-row conditions
// of CheckSharedPostingAccess, which already allowed this read.
func (d *Database) feedAudiences(feedGroupID, ownerID, postingID string, posting types.Posting, requesterID string) ([]store.GroupFeedAudience, bool, error) {
	audiences := []store.GroupFeedAudience{}
	seenGroups := map[string]bool{}
	addGroup := func(groupID string) error {
		if seenGroups[groupID] {
			return nil
		}
		seenGroups[groupID] = true
		name, err := d.groupDisplayName(groupID)
		if err != nil {
			return err
		}
		audiences = append(audiences, store.GroupFeedAudience{Type: store.FeedAudienceGroup, ID: groupID, Name: name})
		return nil
	}
	inFeed := false
	// Manual group grants authorizing this viewer: current membership on
	// both sides, matching the gate's group-grant arm.
	grantRows, err := d.db.Query(`SELECT DISTINCT audience_id FROM sharing_grants
		WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'group' AND intent = 'shared'`, ownerID, postingID)
	if err != nil {
		return nil, false, err
	}
	var grantGroups []string
	for grantRows.Next() {
		var groupID string
		if err := grantRows.Scan(&groupID); err != nil {
			grantRows.Close()
			return nil, false, err
		}
		grantGroups = append(grantGroups, groupID)
	}
	if err := grantRows.Err(); err != nil {
		grantRows.Close()
		return nil, false, err
	}
	grantRows.Close()
	for _, groupID := range grantGroups {
		requesterRole, err := d.groupRole(groupID, requesterID)
		if err != nil {
			return nil, false, err
		}
		if requesterRole == "" {
			continue
		}
		ownerRole, err := d.groupRole(groupID, ownerID)
		if err != nil {
			return nil, false, err
		}
		if ownerRole == "" {
			continue
		}
		if err := addGroup(groupID); err != nil {
			return nil, false, err
		}
		if groupID == feedGroupID {
			inFeed = true
		}
	}
	// Automatic policy paths: the owner's enabled policy for each group
	// where both parties hold current membership and the posting's current
	// accounts and transaction date qualify, matching the gate's policy arm.
	policyRows, err := d.db.Query(`SELECT sp.owner_user_id, sp.group_id, sp.enabled, sp.account_ids_json, sp.start_date, sp.end_date, sp.version, sp.updated_at
		FROM sharing_policies sp
		JOIN group_members requester ON requester.group_id = sp.group_id AND requester.user_id = ?
		JOIN group_members owner ON owner.group_id = sp.group_id AND owner.user_id = sp.owner_user_id
		WHERE sp.owner_user_id = ? AND sp.enabled = 1`, requesterID, ownerID)
	if err != nil {
		return nil, false, err
	}
	var policies []store.SharingPolicy
	for policyRows.Next() {
		policy, err := scanSharingPolicy(policyRows)
		if err != nil {
			policyRows.Close()
			return nil, false, err
		}
		policies = append(policies, policy)
	}
	if err := policyRows.Err(); err != nil {
		policyRows.Close()
		return nil, false, err
	}
	policyRows.Close()
	for _, policy := range policies {
		if !store.PolicyCoversPosting(policy, posting) {
			continue
		}
		if err := addGroup(policy.GroupID); err != nil {
			return nil, false, err
		}
		if policy.GroupID == feedGroupID {
			inFeed = true
		}
	}
	// Direct manual grants surface in the feed when the source owner is a
	// current member of the feed group. The grant needs no membership to
	// authorize (FND-02); the membership scopes which group feed shows it.
	var direct int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants
		WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, requesterID).Scan(&direct); err != nil {
		return nil, false, err
	}
	if direct > 0 {
		ownerRole, err := d.groupRole(feedGroupID, ownerID)
		if err != nil {
			return nil, false, err
		}
		if ownerRole != "" {
			display, err := d.feedDisplayName(feedGroupID, ownerID)
			if err != nil {
				return nil, false, err
			}
			audiences = append(audiences, store.GroupFeedAudience{Type: store.FeedAudienceDirect, Name: display})
			inFeed = true
		}
	}
	return audiences, inFeed, nil
}

// feedDisplayName resolves the name the feed group knows the source member
// by, falling back to the member identifier the group roster already shows.
func (d *Database) feedDisplayName(groupID, ownerID string) (string, error) {
	var display sql.NullString
	if err := d.db.QueryRow(`SELECT display_name FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, ownerID).Scan(&display); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ownerID, nil
		}
		return "", err
	}
	if display.Valid && display.String != "" {
		return display.String, nil
	}
	return ownerID, nil
}

// groupDisplayName resolves a group's current name for feed audience
// labels. A group the viewer cannot see reports its bare identifier so
// labels never enumerate hidden groups; every group named here already
// authorizes this viewer, so its name is visible to them.
func (d *Database) groupDisplayName(groupID string) (string, error) {
	var name sql.NullString
	if err := d.db.QueryRow(`SELECT name FROM user_groups WHERE id = ?`, groupID).Scan(&name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return groupID, nil
		}
		return "", err
	}
	if name.Valid && name.String != "" {
		return name.String, nil
	}
	return groupID, nil
}
