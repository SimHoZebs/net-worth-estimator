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
	Date      string
	Balance   float64
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

// DocumentETag returns a content identity for the canonical model document.
func DocumentETag(document *types.FinancialModelDocument) (string, error) {
	if document == nil {
		return `""`, nil
	}
	payload, err := json.Marshal(document)
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
