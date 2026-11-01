package store

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const (
	SourceUser = "user"

	// SourceSimpleFIN is the sync source written by the current SimpleFIN
	// adapter. Other providers must use their own source value.
	SourceSimpleFIN = "simplefin"
)

const (
	LinkOriginManual = "manual"
	LinkOriginAuto   = "auto"
)

const (
	GroupRoleOwner  = "owner"
	GroupRoleAdmin  = "admin"
	GroupRoleMember = "member"
)

const ReceiptStorageLimit = 100 << 20

// AccountLink binds one SimpleFIN bridge account to one model account.
// Links are sync metadata: owner payloads never carry them, model saves
// never rewrite them, and a vanished bridge account leaves its link and
// data in place (stale, never deleted by sync).
type AccountLink struct {
	BridgeAccountID string `json:"bridgeAccountId"`
	ModelAccountID  string `json:"modelAccountId"`
	BridgeName      string `json:"bridgeName"`
	Currency        string `json:"currency"`
	Origin          string `json:"origin"`
	LastSeenAt      string `json:"lastSeenAt"`
}

// EvaluationUpdate is one generic evaluation row for create/update.
type EvaluationUpdate struct {
	Type       string         `json:"type"`
	InstanceID string         `json:"instanceId,omitempty"`
	Name       string         `json:"name"`
	Enabled    bool           `json:"enabled"`
	Config     map[string]any `json:"config,omitempty"`
}

// SyncCredential is the stored per-plan SimpleFIN credential. AccessURL is
// a secret and must never leave the server in API payloads or logs.
type SyncCredential struct {
	AccessURL    string `json:"-"`
	BridgeHost   string
	UpdatedAt    string
	CardAccounts []string
}

// Configured reports whether a Bridge key is connected.
func (c SyncCredential) Configured() bool { return c.AccessURL != "" }

type SyncCheckpoint struct {
	AccountID string
	Balance   float64
	// Source is the provider provenance carried from translation (never
	// user). The store validates it at the boundary and never defaults
	// it: owner rows keep collision precedence and repeat writes keep
	// provider identity.
	Source     string
	ObservedAt int64
}

// SyncApplySummary counts applied sync rows.
type SyncApplySummary struct {
	CheckpointsInserted int `json:"checkpointsInserted"`
	CheckpointsUpdated  int `json:"checkpointsUpdated"`
	CheckpointsSkipped  int `json:"checkpointsSkipped"`
	PendingDeleted      int `json:"pendingDeleted"`
	PendingInserted     int `json:"pendingInserted"`
	PendingUpdated      int `json:"pendingUpdated"`
	SettledConverted    int `json:"settledConverted"`
	SettledInserted     int `json:"settledInserted"`
}

// SyncProvision is one bridge account needing link resolution: an
// existing link is touched, otherwise the account is auto-provisioned.
// Manual bindings are made through SaveAccountLink, never here.
type SyncProvision struct {
	BridgeID string
	Name     string
	Currency string
	Kind     types.AccountKind
}

// SyncPosting separates the exact provider identity from the local posting ID.
// The store allocates the UUID. Provider keys are never sanitized or exposed as IDs.
type SyncPosting struct {
	types.Posting
	ProviderAccountID string
	TransactionID     string
	Facts             *types.TransactionFacts
}

// BankKey is one exact upstream identity for a bank row. A row can hold
// several across its life (a pending authorization key, then a posted key).
type BankKey struct {
	Provider      string
	AccountID     string
	TransactionID string
}

// BankRow is one stored bank-reported posting with every upstream identity
// pointing at it. Adapters read these to reconcile a snapshot without
// reimplementing storage.
type BankRow struct {
	Posting types.Posting
	Keys    []BankKey
}

// BankDirective is one reconciled bank write. Adapters translate provider
// behavior into these; the store applies them without interpreting how the
// provider represents lifecycle. Exactly one action is set.
type BankDirective struct {
	Upsert  *BankUpsert
	Convert *BankConvert
	Void    string
	Observe *BankObservation
}

// BankUpsert carries full row values for insert-or-update by key.
type BankUpsert struct {
	Posting types.Posting
	Keys    []BankKey
}

// BankConvert carries settled values for an existing row the adapter
// matched, plus replacement keys.
type BankConvert struct {
	ID      string
	Posting types.Posting
	AddKeys []BankKey
}

// Group describes one user group plus the caller's role in it.
type Group struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	MemberCount int    `json:"memberCount"`
	CreatedAt   int64  `json:"createdAt"`
}

// GroupMember is one membership row with a display snapshot.
type GroupMember struct {
	AccountID   string `json:"accountId"`
	Role        string `json:"role"`
	DisplayName string `json:"displayName"`
	JoinedAt    int64  `json:"joinedAt"`
}

// GroupInvite is a redeemable invite. Code is returned once on create.
type GroupInvite struct {
	ID        string `json:"id"`
	GroupID   string `json:"groupId"`
	ExpiresAt int64  `json:"expiresAt"`
	MaxUses   int    `json:"maxUses"`
	UsedCount int    `json:"usedCount"`
	RevokedAt *int64 `json:"revokedAt,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

// Sharing audience kinds for cross-user transaction authorization (FND-02).
// A grant names one posting owned by one user and visible to one audience:
// a single user, every current member of a group, or (exclusions only) all
// current and future audiences.
const (
	SharingAudienceUser  = "user"
	SharingAudienceGroup = "group"
	SharingAudienceAll   = "all"
)

// Sharing intent states. Explicit intent for one posting plus one audience
// is a single row: default (absent), explicitly shared, or excluded.
// Explicit share and exclusion cannot coexist for the same audience.
const (
	SharingIntentShared   = "shared"
	SharingIntentExcluded = "excluded"
)

// SharingGrant is one explicit owner decision for one posting and audience.
// OwnerUserID and PostingID form the owner-scoped transaction identity;
// AudienceType is user, group, or all (wildcard exclusions only);
// AudienceID is the grantee user ID, group ID, or empty for wildcard.
type SharingGrant struct {
	OwnerUserID string `json:"ownerUserId"`
	PostingID   string `json:"postingId"`
	Audience    string `json:"audienceType"`
	AudienceID  string `json:"audienceId"`
	Intent      string `json:"intent"`
	CreatedAt   int64  `json:"createdAt"`
}

// SharedPostingAccess is the result of a read-time authorization check.
// Allowed is true only when at least one independent valid grant survives
// current membership, exclusion, and revocation state. Reason names the
// surviving grant kind ("manual-user" or "manual-group"); policy-derived
// automatic reasons land with GRP-02.
type SharedPostingAccess struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
}

// SharedPostingRef pairs a shared posting with its source owner. The
// posting value reuses the existing transaction model; there is no
// separate cross-user DTO and no column-level ACL.
type SharedPostingRef struct {
	OwnerUserID string        `json:"ownerUserId"`
	Posting     types.Posting `json:"posting"`
}

// Linked-transaction representation (FND-04). A SharingLink binds one
// source-owner posting to one recipient-owned private copy through
// immutable identities: the source transaction ID (SourceOwnerID plus
// SourcePostingID), the stable LinkID, the SourceRevision observed at the
// last authorized refresh, the recipient owner (RecipientUserID plus
// CopyPostingID), and the sharing-grant identifiers (GrantAudience,
// GrantAudienceID, GrantReason) that authorized the link. The copy itself
// stays an ordinary recipient-owned posting: recipient edits never
// propagate to the source, and refresh never rewrites the copy.
type SharingLink struct {
	LinkID          string `json:"linkId"`
	SourceOwnerID   string `json:"sourceOwnerId"`
	SourcePostingID string `json:"sourcePostingId"`
	SourceRevision  string `json:"sourceRevision"`
	RecipientUserID string `json:"recipientUserId"`
	CopyPostingID   string `json:"copyPostingId"`
	GrantAudience   string `json:"grantAudienceType"`
	GrantAudienceID string `json:"grantAudienceId"`
	GrantReason     string `json:"grantReason"`
	CopiedAt        int64  `json:"copiedAt"`
	RefreshedAt     int64  `json:"refreshedAt"`
}

// Refresh outcomes for a sharing link. "current" means the recipient is
// still authorized and the source matches the recorded revision.
// "source-changed" means the recipient is still authorized but the source
// content moved on: the link records the new revision while the
// recipient's copy keeps its own edits. "unauthorized" means the grant
// was revoked, excluded, or membership ended: the copy and its edits stay
// intact but source changes are no longer visible. "source-gone" means
// the source row no longer exists: the copy stays intact as an ordinary
// row while the link keeps its last recorded revision.
const (
	SharingLinkCurrent      = "current"
	SharingLinkSourceChange = "source-changed"
	SharingLinkUnauthorized = "unauthorized"
	SharingLinkSourceGone   = "source-gone"
)

// SharingLinkRefresh is the result of re-checking one link against live
// authorization and source state. It never carries edited copy content:
// callers read the copy through their own model scope.
type SharingLinkRefresh struct {
	Link                  SharingLink `json:"link"`
	Status                string      `json:"status"`
	CurrentSourceRevision string      `json:"currentSourceRevision,omitempty"`
}

// Social-operation audit and idempotency contract (FND-05). Every mutating
// social request carries a client-generated UUID request ID. The store
// records one outcome row per (actor, request ID): a retry with the same
// key replays the recorded outcome without re-executing, while the same
// key naming a different action or target fails with ErrSharingConflict.
// Replays never append audit rows; only committed mutations do.
//
// Audit rows carry actor, action, target identities, and time only. They
// never carry transaction evidence: no amounts, names, account references,
// memos, or posting content. Dependents (SOC-04B splits, QA-02 concurrency
// coverage) reuse this shape: request IDs close retry races, recorded
// revisions make concurrent edits fail explicitly, and the audit trail
// stays free of private evidence.

// Social audit actions recorded in SharingAuditEvent.Action.
const (
	SharingAuditGrantShared     = "grant-shared"
	SharingAuditRevokeShared    = "revoke-shared"
	SharingAuditExcludeShared   = "exclude-shared"
	SharingAuditRemoveExclusion = "remove-exclusion"
	SharingAuditCopyAccepted    = "copy-accepted"
	SharingAuditLinkRefreshed   = "link-refreshed"
)

// SharingAuditEvent is one committed cross-user change: who acted, what
// they did, which owner-scoped transaction and audience it targets, and
// when. Audience and link fields apply only to the actions that name them;
// Status carries the link-refresh outcome. RequestID ties the event to the
// idempotency key that executed it.
type SharingAuditEvent struct {
	Seq         int64  `json:"seq"`
	ActorUserID string `json:"actorUserId"`
	Action      string `json:"action"`
	OwnerUserID string `json:"ownerUserId"`
	PostingID   string `json:"postingId"`
	Audience    string `json:"audienceType,omitempty"`
	AudienceID  string `json:"audienceId,omitempty"`
	LinkID      string `json:"linkId,omitempty"`
	Status      string `json:"status,omitempty"`
	RequestID   string `json:"requestId"`
	CreatedAt   int64  `json:"createdAt"`
}

// SharingRevocation names one removed consent row: the owner-scoped
// transaction plus the audience it no longer covers. It is the recorded
// outcome of a revoke or exclusion-removal request, so retries replay it.
type SharingRevocation struct {
	OwnerUserID string `json:"ownerUserId"`
	PostingID   string `json:"postingId"`
	Audience    string `json:"audienceType"`
	AudienceID  string `json:"audienceId"`
	Intent      string `json:"intent"`
}

// ModelETag returns a content identity for the canonical model.
func ModelETag(model *types.FinancialModel) (string, error) {
	if model == nil {
		return `""`, nil
	}
	payload, err := json.Marshal(model)
	if err != nil {
		return "", fmt.Errorf("encode model ETag: %w", err)
	}
	digest := sha256.Sum256(payload)
	return fmt.Sprintf(`"sha256-%x"`, digest), nil
}

// PostingReceiptFingerprint derives recovery state without I/O.
func PostingReceiptFingerprint(p types.Posting) string {
	data, _ := json.Marshal(struct {
		Name         string
		Source       *string
		Destinations []string
		Amount       types.PostingAmountResolution
		Time         int64
	}{p.Name, p.SourceAccountID, p.Destinations, p.Amount, p.TransactionTime})
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%x", hash[:])
}

// ValidateAmountPresetName checks the stable key shape before persistence.
func ValidateAmountPresetName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return fmt.Errorf("preset name must be a non-empty string")
	}
	if len(trimmed) > 100 {
		return fmt.Errorf("preset name must be at most 100 characters")
	}
	return nil
}
