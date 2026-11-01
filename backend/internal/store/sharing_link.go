package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Stable linked-transaction identities (FND-04). The link ID names one
// source-owner posting plus one recipient: it is deterministic so any
// holder of the three immutable identities computes the same link without
// a lookup, which also makes repeat accepts and retry replays resolve to
// the same link instead of minting duplicates. The `link_` prefix keeps
// links out of the row-ID registry shared by accounts, postings, rules,
// and evaluations. The source revision is an opaque content hash of the
// source posting observed at copy or refresh time; callers compare
// revisions for staleness and never parse them.

// SharingLinkNamespace versions the link-ID derivation. A future scheme
// change must use a new namespace so old and new links never collide.
const SharingLinkNamespace = "nwe-sharing-link/v1"

// SharingLinkID derives the stable link for one source-owner posting and
// one recipient. The inputs are immutable identities: the source owner's
// user ID, the source posting's UUID, and the recipient's user ID.
func SharingLinkID(sourceOwnerID, sourcePostingID, recipientUserID string) string {
	sum := sha256.Sum256([]byte(SharingLinkNamespace + "\x00" + sourceOwnerID + "\x00" + sourcePostingID + "\x00" + recipientUserID))
	return "link_" + hex.EncodeToString(sum[:])
}

// SharingSourceRevision hashes the canonical JSON of one source posting
// snapshot. Equal content yields equal revisions; any stored field change
// yields a new revision. The hash covers the full stored shape the shared
// read returns, so refresh compares exactly what the recipient saw.
func SharingSourceRevision(posting types.Posting) (string, error) {
	raw, err := json.Marshal(posting)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
