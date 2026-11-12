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

	// SourceBankSync is the row source for bank facts. The provider
	// identity lives in sync keys, not in the row source.
	SourceBankSync = "banksync"
)

// ProviderSimpleFIN identifies the SimpleFIN bridge provider in sync keys.
const ProviderSimpleFIN = "simplefin"

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

// AccountSupersedeResult reports one manual-to-synced account replacement.
// Persisted is false when model validation rejected the candidate; Issues
// carries the reasons and the stored model is unchanged.
type AccountSupersedeResult struct {
	SyncedAccount types.Account
	Issues        []types.ModelValidationIssue
	Persisted     bool
}

// AccountLink binds one SimpleFIN bridge account to one model account.
// Links are sync metadata: owner payloads never carry them, model saves
// never rewrite them, and a vanished bridge account leaves its link and
// data in place (stale, never deleted by sync).
type AccountLink struct {
	BridgeAccountID string `json:"bridgeAccountId"`
	ModelAccountID  string `json:"modelAccountId"`
	BridgeName      string `json:"bridgeName"`
	// Institution is the bank organization name reported by the bridge
	// (SimpleFIN org_name, falling back to the connection name). Empty
	// means unknown, never a label such as "Synced account".
	Institution string `json:"institution,omitempty"`
	Currency    string `json:"currency"`
	Origin      string `json:"origin"`
	LastSeenAt  string `json:"lastSeenAt"`
}

// EvaluationUpdate is one generic evaluation row for create/update.
type EvaluationUpdate struct {
	Type       string         `json:"type"`
	InstanceID string         `json:"instanceId,omitempty"`
	Name       string         `json:"name"`
	Enabled    bool           `json:"enabled"`
	Config     map[string]any `json:"config,omitempty"`
}

// SyncError is the last non-fatal or failed SimpleFIN condition stored for
// display. It never contains the Access URL or raw provider payloads.
type SyncError struct {
	Code         string `json:"code"`
	Message      string `json:"message"`
	Scope        string `json:"scope,omitempty"`
	ConnectionID string `json:"connectionId,omitempty"`
	AccountID    string `json:"accountId,omitempty"`
	ObservedAt   string `json:"observedAt,omitempty"`
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

// GmailCredential is the stored per-user Gmail OAuth state. RefreshToken
// and AccessToken are secrets: they live only in this row and must never
// leave the server in API payloads or logs. Message contents are never
// stored here (INT-02 keeps connection state only); INT-03 scans through
// short-lived access tokens without persisting message bodies.
type GmailCredential struct {
	RefreshToken string `json:"-"`
	AccessToken  string `json:"-"`
	// AccessExpiryUnix is the access token expiry as Unix seconds, 0 when
	// no access token is held.
	AccessExpiryUnix int64 `json:"-"`
	// EmailAddress is the consented Google account, kept for display so
	// the user can verify which account granted access.
	EmailAddress string
	// Scopes records the granted OAuth scopes for consent audit.
	Scopes string
	// ConnectedAt is the RFC3339 connection time, empty when disconnected.
	ConnectedAt string
	// PendingState is the in-flight OAuth CSRF state, empty when no
	// authorization redirect is outstanding. Never exposed.
	PendingState string `json:"-"`
	// PendingAtUnix dates the outstanding authorization redirect.
	PendingAtUnix int64 `json:"-"`
	// LookbackDays bounds the initial scan window. Defaults to
	// DefaultGmailLookbackDays on first read.
	LookbackDays int
	// LastHistoryID is the Gmail history cursor for incremental scans,
	// empty until the first scan completes (INT-03).
	LastHistoryID string
	// LastScanAt is the last successful scan completion time (RFC3339
	// UTC), empty until the first scan completes (INT-03).
	LastScanAt string
}

// DefaultGmailLookbackDays is the initial Gmail scan lookback both when
// no preference is stored and when the user resets it.
const DefaultGmailLookbackDays = 90

// Connected reports whether a Gmail refresh token is stored.
func (c GmailCredential) Connected() bool { return c.RefreshToken != "" }

type SyncCheckpoint struct {
	AccountID string
	Balance   float64
	// AvailableBalance is the Bridge's available balance when it reported
	// one. Nil means unknown, not zero. It never replaces Balance.
	AvailableBalance *float64
	// Source is the bank-fact category carried from translation (never
	// user). The store validates it at the boundary and never defaults
	// it: owner rows keep collision precedence and repeat writes keep
	// provider identity.
	Source string
	// Provider identifies the bridge that supplied the observation
	// (simplefin today). Same-instant refresh matches on provider, so
	// two bridges never overwrite each other.
	Provider   string
	ObservedAt int64
}

// SyncCheckpointKey identifies one provider-owned checkpoint row by account,
// exact observation instant, and supplying provider.
type SyncCheckpointKey struct {
	AccountID  string
	ObservedAt int64
	Provider   string
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
// existing link is touched, otherwise the account is auto-provisioned
// with the neutral cash label. The owner configures the real type in
// the UI; provisioning never infers it from bridge data. Manual
// bindings are made through SaveAccountLink, never here.
type SyncProvision struct {
	BridgeID string
	Name     string
	// Institution is the bank organization name for the bridge
	// connection, empty when the bridge reported none.
	Institution string
	Currency    string
}

// GeneratedTransaction is one engine-output transaction for a slice. Generated
// rows carry the public event as JSON and never participate in model reads,
// sync reconciliation, or analysis: every model query filters them out by
// null slice.
type GeneratedTransaction struct {
	SliceID         string
	Name            string
	SourceAccountID *string
	DestinationIDs  []string
	PostedTime      int64
	TransactionTime int64
	EventJSON       string
	AppliedAmount   float64
	Outcome         string
}

// ProjectionRowPayload is one persisted timeline row for a slice date.
type ProjectionRowPayload struct {
	SliceID string
	Date    string
	Payload string
}

// SyncTransaction separates the exact provider identity from the local transaction ID.
// The store allocates the UUID. Provider keys are never sanitized or exposed as IDs.
type SyncTransaction struct {
	types.Transaction
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

// BankRow is one stored bank-reported transaction with every upstream identity
// pointing at it. Adapters read these to reconcile a snapshot without
// reimplementing storage.
type BankRow struct {
	Transaction types.Transaction
	Keys        []BankKey
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

// BankUpsert carries full row values for insert-or-update by key. Facts
// carries the source evidence observed in the same snapshot, so the first
// sync stores evidence and category hints without waiting for a later pass.
type BankUpsert struct {
	Transaction types.Transaction
	Keys        []BankKey
	Facts       *types.TransactionFacts
}

// BankConvert carries settled values for an existing row the adapter
// matched, plus replacement keys.
type BankConvert struct {
	ID          string
	Transaction types.Transaction
	AddKeys     []BankKey
	Facts       *types.TransactionFacts
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

// Friend is one accepted friendship edge with a display snapshot.
// Edges are directed: user A listing friends reads rows keyed by A, and a
// complete friendship holds both directions. The request lifecycle that
// writes these rows is not built yet; reads below never invent edges.
type Friend struct {
	AccountID   string `json:"accountId"`
	DisplayName string `json:"displayName"`
	CreatedAt   int64  `json:"createdAt"`
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
// A grant names one transaction owned by one user and visible to one audience:
// a single user, every current member of a group, or (exclusions only) all
// current and future audiences.
const (
	SharingAudienceUser  = "user"
	SharingAudienceGroup = "group"
	SharingAudienceAll   = "all"
)

// Sharing intent states. Explicit intent for one transaction plus one audience
// is a single row: default (absent), explicitly shared, or excluded.
// Explicit share and exclusion cannot coexist for the same audience.
const (
	SharingIntentShared   = "shared"
	SharingIntentExcluded = "excluded"
)

// SharingGrant is one explicit owner decision for one transaction and audience.
// OwnerUserID and TransactionID form the owner-scoped transaction identity;
// AudienceType is user, group, or all (wildcard exclusions only);
// AudienceID is the grantee user ID, group ID, or empty for wildcard.
type SharingGrant struct {
	OwnerUserID   string `json:"ownerUserId"`
	TransactionID string `json:"transactionId"`
	Audience      string `json:"audienceType"`
	AudienceID    string `json:"audienceId"`
	Intent        string `json:"intent"`
	CreatedAt     int64  `json:"createdAt"`
}

// SharingPolicy is one member's automatic transaction-sharing preference
// for one group (GRP-02). Absence of a row means automatic sharing is off:
// there is no enabled-by-default state and no admin override. The member
// alone opts in by enabling with one or more owner-held accounts and a
// single transaction-date interval. StartDate persists as a fixed
// YYYY-MM-DD day (defaulting to the setup day, never rolling); EndDate is
// "" for open-ended. Version bumps on every committed change so later
// reference indexes can fence stale generations.
type SharingPolicy struct {
	OwnerUserID string   `json:"ownerUserId"`
	GroupID     string   `json:"groupId"`
	Enabled     bool     `json:"enabled"`
	AccountIDs  []string `json:"accountIds"`
	StartDate   string   `json:"startDate"`
	EndDate     string   `json:"endDate,omitempty"`
	Version     int64    `json:"version"`
	UpdatedAt   int64    `json:"updatedAt"`
}

// SharingPolicyInput carries one member's editable preference values.
// StartDate "" means the setup day (today on the shared calendar);
// EndDate "" means open-ended.
type SharingPolicyInput struct {
	Enabled    bool     `json:"enabled"`
	AccountIDs []string `json:"accountIds"`
	StartDate  string   `json:"startDate,omitempty"`
	EndDate    string   `json:"endDate,omitempty"`
}

// SharingPolicyPreview is the counts-only exposure preview shown before
// enabling history. It carries audience size and eligible-row counts plus
// the interval and account coverage, never amounts, payees, or row IDs.
type SharingPolicyPreview struct {
	OwnerUserID          string   `json:"ownerUserId"`
	GroupID              string   `json:"groupId"`
	Enabled              bool     `json:"enabled"`
	AccountIDs           []string `json:"accountIds"`
	StartDate            string   `json:"startDate"`
	EndDate              string   `json:"endDate,omitempty"`
	Version              int64    `json:"version"`
	EligibleTransactions int      `json:"eligibleTransactions"`
	MemberCount          int      `json:"memberCount"`
}

// SharedTransactionAccess is the result of a read-time authorization check.
// Allowed is true only when at least one independent valid grant survives
// current membership, exclusion, and revocation state. Reason names the
// surviving grant kind ("manual-user", "manual-group") or the
// policy-derived automatic reason ("automatic-group", GRP-02).
type SharedTransactionAccess struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
}

// SharedTransactionRef pairs a shared transaction with its source owner. The
// transaction value reuses the existing transaction model; there is no
// separate cross-user DTO and no column-level ACL.
type SharedTransactionRef struct {
	OwnerUserID string            `json:"ownerUserId"`
	Transaction types.Transaction `json:"transaction"`
}

// Linked-transaction representation (FND-04). A SharingLink binds one
// source-owner transaction to one recipient-owned private copy through
// immutable identities: the source transaction ID (SourceOwnerID plus
// SourceTransactionID), the stable LinkID, the SourceRevision observed at the
// last authorized refresh, the recipient owner (RecipientUserID plus
// CopyTransactionID), and the sharing-grant identifiers (GrantAudience,
// GrantAudienceID, GrantReason) that authorized the link. The copy itself
// stays an ordinary recipient-owned transaction: recipient edits never
// propagate to the source, and refresh never rewrites the copy.
type SharingLink struct {
	LinkID              string `json:"linkId"`
	SourceOwnerID       string `json:"sourceOwnerId"`
	SourceTransactionID string `json:"sourceTransactionId"`
	SourceRevision      string `json:"sourceRevision"`
	RecipientUserID     string `json:"recipientUserId"`
	CopyTransactionID   string `json:"copyTransactionId"`
	GrantAudience       string `json:"grantAudienceType"`
	GrantAudienceID     string `json:"grantAudienceId"`
	GrantReason         string `json:"grantReason"`
	CopiedAt            int64  `json:"copiedAt"`
	RefreshedAt         int64  `json:"refreshedAt"`
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

// Inbox item kinds (FND-03). "share" items arrive through FND-02 grants and
// are derived from the ListSharedTransactions primitive. "split-request" is the
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
// inbox. Preview (Transaction) is present only while the recipient is
// currently authorized; without authorization the item carries sender
// identity, status, and timestamps only, never transaction content.
type InboxShareItem struct {
	Kind              string             `json:"kind"`
	OwnerUserID       string             `json:"ownerUserId"`
	TransactionID     string             `json:"transactionId"`
	SenderDisplayName string             `json:"senderDisplayName,omitempty"`
	Status            string             `json:"status"`
	Unread            bool               `json:"unread"`
	Dismissed         bool               `json:"dismissed"`
	ReceivedAt        int64              `json:"receivedAt"`
	DecidedAt         int64              `json:"decidedAt,omitempty"`
	CopyTransactionID string             `json:"copyTransactionId,omitempty"`
	Transaction       *types.Transaction `json:"transaction,omitempty"`
}

// Social audit actions for accepted copies and link refreshes. Consent
// actions reuse the landed sharing_audit kinds ('grant', 'revoke',
// 'exclude', 'unexclude'); splits reuse their own hyphenated kinds.
const (
	SharingAuditCopyAccepted  = "copy-accepted"
	SharingAuditLinkRefreshed = "link-refreshed"
)

// SharingAuditEvent is one committed cross-user change: who acted, what
// they did, which owner-scoped transaction it targets, and when.
// Audience names the consent target for grant/revoke/exclude/unexclude
// rows. Link, Status, and RequestID decode from the audit detail payload:
// the accepted-copy link, the link-refresh outcome, and the idempotency
// key that executed the mutation. Consent rows carry the key; split rows
// carry link, status, and key. The event never carries transaction
// evidence.
type SharingAuditEvent struct {
	Seq           int64  `json:"seq"`
	ActorUserID   string `json:"actorUserId"`
	Action        string `json:"action"`
	OwnerUserID   string `json:"ownerUserId"`
	TransactionID string `json:"transactionId"`
	Audience      string `json:"audienceType,omitempty"`
	AudienceID    string `json:"audienceId,omitempty"`
	LinkID        string `json:"linkId,omitempty"`
	Status        string `json:"status,omitempty"`
	RequestID     string `json:"requestId,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
}

// SharingRevocation names one removed consent row: the owner-scoped
// transaction plus the audience it no longer covers. It is the recorded
// outcome of a revoke or exclusion-removal request, so retries replay it.
// It carries identities only, never transaction evidence.
type SharingRevocation struct {
	OwnerUserID   string `json:"ownerUserId"`
	TransactionID string `json:"transactionId"`
	Audience      string `json:"audienceType"`
	AudienceID    string `json:"audienceId"`
	Intent        string `json:"intent"`
}

// Feed audience types naming one path through which the viewer is
// authorized for a feed item: a group the item is shared in, or a direct
// share from the source member.
const (
	FeedAudienceGroup  = "group"
	FeedAudienceDirect = "direct"
)

// GroupFeedAudience names one authorizing path for a feed item as the
// viewer sees it. Group paths carry the group's current name; a direct
// share carries the source member's display name in Name with an empty ID.
type GroupFeedAudience struct {
	Type string `json:"type"`
	ID   string `json:"id,omitempty"`
	Name string `json:"name"`
}

// GroupFeedItem is one transaction in a group feed. The transaction reuses the
// existing transaction shape; SourceDisplayName is the name the group
// knows the source member by, and Audiences lists every path authorizing
// this viewer (group names plus direct share), so a transaction reachable
// several ways still lists once.
type GroupFeedItem struct {
	OwnerUserID       string              `json:"ownerUserId"`
	SourceDisplayName string              `json:"sourceDisplayName"`
	Audiences         []GroupFeedAudience `json:"audiences"`
	Transaction       types.Transaction   `json:"transaction"`
}

// GroupFeedTotals are the viewer-specific totals over the filtered feed
// set: Count lists each authorized transaction once, TotalAmount sums the
// fixed-amount transactions rounded to cents, VaryingCount names how many
// counted transactions carry calculated amounts outside the sum, and
// PendingCount names how many counted transactions are pending bank rows.
type GroupFeedTotals struct {
	Count        int     `json:"count"`
	TotalAmount  float64 `json:"totalAmount"`
	VaryingCount int     `json:"varyingCount"`
	PendingCount int     `json:"pendingCount"`
}

// Email receipt verdicts (INT-03). Receipt and refund verdicts carry
// extracted evidence for INT-04 matching; shipping-only and ordinary
// verdicts record only the Gmail message identity for scan dedupe and
// never extraction fields. Failed verdicts isolate a per-message
// fetch/parse failure with diagnostics instead of failing the scan.
const (
	EmailReceiptVerdictReceipt  = "receipt"
	EmailReceiptVerdictRefund   = "refund"
	EmailReceiptVerdictShipping = "shipping-only"
	EmailReceiptVerdictOrdinary = "ordinary"
	EmailReceiptVerdictFailed   = "failed"
)

// Email receipt review statuses. Ready means high-confidence extraction
// with nothing to review; needs-review means low-confidence extraction
// awaiting the user; confirmed means the user confirmed or corrected it.
const (
	EmailReceiptStatusReady       = "ready"
	EmailReceiptStatusNeedsReview = "needs-review"
	EmailReceiptStatusConfirmed   = "confirmed"
)

// EmailReceiptCorrection is the user's confirmed or corrected extraction.
// The original extracted values stay in the row; the correction overlays
// them, so review never rewrites immutable source evidence.
type EmailReceiptCorrection struct {
	Merchant    string `json:"merchant,omitempty"`
	ReceiptDate string `json:"receiptDate,omitempty"`
	AmountCents *int64 `json:"amountCents,omitempty"`
	Currency    string `json:"currency,omitempty"`
	Reference   string `json:"reference,omitempty"`
}

// EmailReceipt is one Gmail message triaged by receipt discovery. Message
// bodies and snippets are never persisted: only the message identity,
// display headers for receipt-like mail, extracted evidence, provenance,
// and review state are stored. Ordinary and shipping-only mail keep the
// identity and verdict only, so repeat scans dedupe without retaining
// mail content.
type EmailReceipt struct {
	ID             string                  `json:"id"`
	GmailMessageID string                  `json:"gmailMessageId"`
	ThreadID       string                  `json:"threadId,omitempty"`
	FromAddress    string                  `json:"fromAddress,omitempty"`
	Subject        string                  `json:"subject,omitempty"`
	MessageDate    string                  `json:"messageDate,omitempty"`
	Verdict        string                  `json:"verdict"`
	Merchant       string                  `json:"merchant,omitempty"`
	ReceiptDate    string                  `json:"receiptDate,omitempty"`
	AmountText     string                  `json:"amountText,omitempty"`
	AmountCents    *int64                  `json:"amountCents,omitempty"`
	Currency       string                  `json:"currency,omitempty"`
	Reference      string                  `json:"reference,omitempty"`
	Confidence     *float64                `json:"confidence,omitempty"`
	Diagnostics    []string                `json:"diagnostics,omitempty"`
	Provenance     types.ReceiptProvenance `json:"provenance"`
	Status         string                  `json:"status"`
	Correction     *EmailReceiptCorrection `json:"correction,omitempty"`
	ScannedAt      string                  `json:"scannedAt"`
}

// EmailReceiptFilter selects extracted receipts for review and matching.
// Verdict and Status are exact matches when non-empty; Cursor pages past
// a receipt ID; Limit caps rows (defaults and maxima apply at the store).
type EmailReceiptFilter struct {
	Verdict []string
	Status  []string
	Cursor  string
	Limit   int
}

// ReceiptProvenanceForEmail identifies extracted email receipt
// provenance. It versions the complete INT-03 detector/extractor
// composition so a future change invalidates cached review standing,
// and INT-04 matching consumes the same identity for receipt claims.
func ReceiptProvenanceForEmail() types.ReceiptProvenance {
	return types.ReceiptProvenance{Producer: "gmail-receipt-email", Version: "v1"}
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

// TransactionReceiptFingerprint derives recovery state without I/O.
func TransactionReceiptFingerprint(p types.Transaction) string {
	data, _ := json.Marshal(struct {
		Name         string
		Source       *string
		Destinations []string
		Amount       types.TransactionAmountResolution
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
