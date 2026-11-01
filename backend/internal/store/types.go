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

// Inbox item kinds (FND-03). "share" items arrive through FND-02 grants and
// are derived from the ListSharedPostings primitive. "split-request" is the
// producer contract for SOC-03 (assigned shares) and SOC-04C (split
// requests): those producers persist their own request rows (split
// persistence itself belongs to SOC-04B) and surface them through the same
// item envelope and status vocabulary below.
const (
	InboxKindShare        = "share"
	InboxKindSplitRequest = "split-request"
)

// Inbox item statuses. Pending, accepted, and declined record the
// recipient's own decision state; canceled is derived when a previously
// visible share loses authorization (revocation, exclusion, ended
// membership, or source deletion) before the recipient decides. A recorded
// accept or decline wins over a later loss of authorization.
const (
	InboxStatusPending  = "pending"
	InboxStatusAccepted = "accepted"
	InboxStatusDeclined = "declined"
	InboxStatusCanceled = "canceled"
)

// InboxShareItem is one received transaction share in the recipient's
// inbox. Preview (Posting) is present only while the recipient is
// currently authorized; without authorization the item carries sender
// identity, status, and timestamps only, never transaction content.
type InboxShareItem struct {
	Kind              string         `json:"kind"`
	OwnerUserID       string         `json:"ownerUserId"`
	PostingID         string         `json:"postingId"`
	SenderDisplayName string         `json:"senderDisplayName,omitempty"`
	Status            string         `json:"status"`
	Unread            bool           `json:"unread"`
	Dismissed         bool           `json:"dismissed"`
	ReceivedAt        int64          `json:"receivedAt"`
	DecidedAt         int64          `json:"decidedAt,omitempty"`
	CopyPostingID     string         `json:"copyPostingId,omitempty"`
	Posting           *types.Posting `json:"posting,omitempty"`
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
