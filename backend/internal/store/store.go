package store

import (
	"context"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Store is the persistence seam behind the canonical model, projection
// artifacts, and SimpleFIN sync state. The server, API handlers,
// and sync runner depend only on this interface. Backends (SQLite files,
// CSV directories, S3 blobs, a human with paper and mic, Turso, Postgres,
// …) implement these methods plus a constructor, then run the conformance
// suite in storetest to prove it.
//
// Contract notes for implementers:
//   - Every operation belongs to one immutable user scope. There is no default
//     scope and no database-wide financial operation.
//   - Writes are single-threaded by the caller discipline (one server, one
//     instance); the backend must still serialize concurrent writes safely.
//   - Readers always see the latest committed state (no stale replicas).
//   - A fresh backend reports ModelExists() == false. InitializeModel
//     activates an empty model without replacing existing data.
//   - Clear resets this user's model, sync state (including the Bridge key
//     and card selection), settings, and artifacts. It preserves amount
//     presets, other users, and identity state. Use
//     ClearSyncCredential to disconnect the key while keeping cards.
//   - Missing rows report ErrNotFound (or IsNotFound). Backends must not
//     leak sql.ErrNoRows, missing files, or other mechanism errors.
type Store interface {
	ReceiptStore
	AnalysisStore
	LoadModel() (*types.FinancialModel, error)
	ModelExists() (bool, error)
	InitializeModel() error
	ImportModel(doc *types.FinancialModel) (*types.FinancialModel, error)
	CreateAccount(account types.Account) (types.Account, error)
	UpdateAccount(account types.Account) (types.Account, error)
	DeleteAccount(id string) error
	MoveAccount(id, beforeID string) error
	// CreateAccountWithBalance stores an account and, when balance is set,
	// its opening balance observation in one transaction. UpdateAccountWithBalance
	// does the same for an account edit plus a moved observation.
	CreateAccountWithBalance(account types.Account, balance *float64, observedAt int64) (types.Account, error)
	UpdateAccountWithBalance(account types.Account, balance *float64, observedAt int64) (types.Account, error)
	CreatePosting(posting types.Posting) (types.Posting, error)
	UpdatePosting(posting types.Posting) (types.Posting, error)
	DeletePosting(id string) error
	MovePosting(id, beforeID string) error
	CreatePlannedPurchase(purchase types.PlannedPurchase) (types.PlannedPurchase, error)
	UpdatePlannedPurchase(purchase types.PlannedPurchase) (types.PlannedPurchase, error)
	DeletePlannedPurchase(id string) error
	MovePlannedPurchase(id, beforeID string) error
	// ConvertPostingToRule and ConvertRuleToPosting move one entry
	// across the posting/rule tables in one store transaction, keeping its ID.
	ConvertPostingToRule(postingID string, rule types.RecurrenceRule) (types.RecurrenceRule, error)
	ConvertRuleToPosting(ruleID string, posting types.Posting) (types.Posting, error)
	CreateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error)
	UpdateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error)
	DeleteRule(id string) error
	MoveRule(id, beforeID string) error
	SaveCheckpoint(checkpoint types.Checkpoint) (types.Checkpoint, error)
	DeleteCheckpointAt(accountID string, observedAt int64) error
	CreateEvaluation(item EvaluationUpdate) (EvaluationUpdate, error)
	UpdateEvaluation(item EvaluationUpdate) (EvaluationUpdate, error)
	DeleteEvaluation(instanceID string) error
	MoveEvaluation(evalType, instanceID, beforeID string) error
	SavePaymentTerms(terms types.PaymentTerms) (types.PaymentTerms, error)
	DeletePaymentTerms(accountID string) error
	ListAmountPresets() ([]types.AmountPreset, error)
	CreateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error)
	UpdateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error)
	DeleteAmountPreset(id string) error
	MoveAmountPreset(id, beforeID string) error
	ListPinnedEvaluations() ([]string, error)
	GetSafeSpendingSettings() (*types.SafeSpendingSettings, error)
	SetSafeSpendingSettings(types.SafeSpendingSettings) error
	SetPinnedEvaluations(ids []string) ([]string, error)
	ListAccountLinks() ([]AccountLink, error)
	SaveAccountLink(link AccountLink) (AccountLink, error)
	DeleteAccountLink(bridgeAccountID string) error
	ProvisionSyncAccounts(items []SyncProvision) (map[string]string, int, []string, error)
	GetSyncCredential() (SyncCredential, error)
	SetSyncCredential(accessURL, bridgeHost string) (SyncCredential, error)
	ClearSyncCredential() error
	GetSyncCards() ([]string, error)
	SetSyncCards(cards []string) ([]string, error)
	GetLastSyncTime() (string, error)
	SetLastSyncTime(completedAt string) error
	GetArtifact(identity string) (string, bool, error)
	PutArtifact(identity, kind, payload string) error
	ApplySyncPlan(checkpoints []SyncCheckpoint, directives []BankDirective) (SyncApplySummary, error)
	LoadBankPostings() ([]BankRow, error)
	Clear() error
	Close() error
}

// ReceiptStore is the user-scoped persistence boundary for evidence only.
type ReceiptStore interface {
	CreateReceipt(ctx context.Context, postingID, filename string, image types.ReceiptImage) (types.Receipt, error)
	ListReceipts(postingID string) ([]types.Receipt, error)
	ListPostingReceiptIDs() (map[string][]string, error)
	GetReceipt(id string) (types.Receipt, error)
	GetReceiptImage(ctx context.Context, id string) (types.ReceiptImage, error)
	ReplaceReceiptImage(ctx context.Context, id string, expectedRevision int64, filename string, image types.ReceiptImage) (types.Receipt, error)
	SaveReceipt(receipt types.Receipt, expectedRevision int64) (types.Receipt, error)
	DeleteReceipt(ctx context.Context, id string) error
}

// Database owns the application lifecycle: user routing, group persistence,
// blob cleanup, and health. Financial operations use a Store returned for an
// explicit user. Backends implement this plus Open/Setup constructors; the
// rest of the backend depends only on this interface, never on files, SQL,
// or driver handles.
type Database interface {
	Close() error
	PingContext(ctx context.Context) error
	HasUser(userID string) (bool, error)
	User(userID string) (Store, error)
	EnsureUser(userID, issuer, subject string) (Store, error)
	EnsureGroupUser(issuer, subject string) (string, error)
	CreateGroup(userID, name, displayName string) (Group, error)
	ListGroupsForUser(userID string) ([]Group, error)
	GetGroup(groupID, userID string) (Group, error)
	RenameGroup(groupID, userID, name string) error
	DeleteGroup(groupID, userID string) error
	ListGroupMembers(groupID, userID string) ([]GroupMember, error)
	UpdateMemberRole(groupID, callerID, targetID, role string) error
	RemoveMember(groupID, callerID, targetID string) error
	LeaveGroup(groupID, userID string) error
	CreateInvite(groupID, userID string, maxUses int, ttl time.Duration) (GroupInvite, string, error)
	ListInvites(groupID, userID string) ([]GroupInvite, error)
	RevokeInvite(groupID, inviteID, userID string) error
	AcceptInvite(code, userID, displayName string) (Group, error)
	TouchMemberDisplay(userID, displayName string)
	RemoveGroupMembershipsForUser(userID string) error
	// GrantSharedPosting records the owner's explicit decision to share one
	// of their postings with one audience (a user or a group). Only the
	// source owner may grant; callers must pass the authenticated owner's
	// own user ID. A grant for an audience with an active exclusion is
	// rejected until the exclusion is removed. Grants are idempotent.
	GrantSharedPosting(ownerID, postingID, audienceType, audienceID string) (SharingGrant, error)
	// RevokeSharedPosting deletes one explicit grant. Subsequent reads deny
	// access unless another independent valid grant survives.
	RevokeSharedPosting(ownerID, postingID, audienceType, audienceID string) error
	// ExcludeSharedPosting records the owner's explicit exclusion of one
	// audience for one posting, including a wildcard (audience "all") that
	// covers current and future audiences. An audience with an active grant
	// cannot be excluded until the grant is revoked. Exclusions are
	// idempotent. A user exclusion denies that person even through group
	// grants; other group members stay authorized.
	ExcludeSharedPosting(ownerID, postingID, audienceType, audienceID string) (SharingGrant, error)
	// RemoveSharedExclusion deletes one explicit exclusion.
	RemoveSharedExclusion(ownerID, postingID, audienceType, audienceID string) error
	// ListSharingGrants returns the owner's explicit grants and exclusions.
	ListSharingGrants(ownerID string) ([]SharingGrant, error)
	// CheckSharedPostingAccess evaluates read-time authorization for one
	// owner-scoped posting and requester: current group and source-owner
	// membership, owner consent (explicit grant or enabled automatic-sharing
	// policy covering the posting's current accounts and transaction date),
	// exclusions, and revocation state. It queries current rows on every call;
	// there is no positive auth cache and no materialized index shortcut.
	CheckSharedPostingAccess(ownerID, postingID, requesterID string) (SharedPostingAccess, error)
	// ReadSharedPosting returns the owner's posting in the existing
	// transaction shape when the requester is currently authorized. Missing
	// and denied postings both report ErrNotFound so existence is not
	// enumerable. It never exposes accounts, balances, models, secrets,
	// or receipts.
	ReadSharedPosting(ownerID, postingID, requesterID string) (types.Posting, error)
	// ListSharedPostings returns every posting currently shared with the
	// requester, each in the existing transaction shape with its owner.
	ListSharedPostings(requesterID string) ([]SharedPostingRef, error)
	// CopySharedPosting accepts one authorized shared posting into the
	// requester's own private model as an independent row: new ID,
	// recipient ownership, no claim, and no remote coupling. The copy is
	// owner-authored (SourceUser, never pending or void) with no bank sync
	// key, so accepting a share never manufactures a duplicate bank
	// posting. Copies are idempotent per source-plus-recipient triple:
	// repeat accepts return the existing recipient row, with its edits
	// intact, instead of minting duplicates. Every copy records its
	// stable link identity (FND-04). Later revocation never rewrites or
	// erases the copy. Source-original writes by another member stay
	// deferred (no such path exists).
	CopySharedPosting(ownerID, postingID, requesterID string) (types.Posting, error)
	// GetSharingLink resolves the stable link for one of the recipient's
	// own copies. It reports ErrNotFound for unknown copies, copies owned
	// by another recipient, and malformed IDs, so link memory is never
	// enumerable across users. It performs no source authorization check:
	// the link is the recipient's own provenance.
	GetSharingLink(recipientID, copyPostingID string) (SharingLink, error)
	// GetSharingLinkByID resolves one of the recipient's links by its
	// stable link ID, for callers that hold links (group feeds, splits,
	// audit) rather than copy row IDs. Scope and failure behavior match
	// GetSharingLink.
	GetSharingLinkByID(linkID, recipientID string) (SharingLink, error)
	// RefreshSharingLink re-checks one of the recipient's links against
	// live authorization and source state and records the outcome on the
	// link row. It never writes the recipient's copy: recipient edits
	// survive refresh, revocation, and source deletion alike. See
	// SharingLinkRefresh for the status contract.
	RefreshSharingLink(recipientID, copyPostingID string) (SharingLinkRefresh, error)
	// WithdrawUserGrant deletes a direct user-audience grant addressed to
	// the recipient themselves. It is the recipient's own refusal path: it
	// never touches grants addressed to anyone else or group-audience
	// grants (which belong to the source owner and their whole audience).
	// Missing grants report ErrNotFound; malformed IDs report
	// ErrGroupInvalid.
	WithdrawUserGrant(recipientID, ownerID, postingID string) error
	// ListInboxItems returns the recipient's received-share inbox. Entries
	// derive from the ListSharedPostings primitive: currently authorized
	// shares appear with their preview, previously seen shares that lost
	// authorization appear as canceled without content, and recorded
	// decisions (accepted/declined) survive later revocation. Sighting rows
	// never authorize; every preview re-checks current access.
	ListInboxItems(recipientID string) ([]InboxShareItem, error)
	// AcceptInboxShare records acceptance and saves one personal
	// recipient-owned copy, reusing CopySharedPosting. It is idempotent
	// under retry: an already-accepted share returns its recorded item
	// without minting another copy, including adoption of a copy the
	// recipient saved through the shared-copies path first. Unauthorized
	// shares report ErrNotFound.
	AcceptInboxShare(recipientID, ownerID, postingID string) (InboxShareItem, error)
	// DeclineInboxShare records the refusal and withdraws the recipient's
	// own direct grant when one addresses them, so they leave the sender's
	// sharing list; group-audience shares stay shared with the group and
	// the refusal remains recipient-local. Retries return the recorded
	// item. Unauthorized shares report ErrNotFound.
	DeclineInboxShare(recipientID, ownerID, postingID string) (InboxShareItem, error)
	// SetInboxShareDismissed hides (or unhides) an item without changing
	// its decision state. Dismissed items leave the default list and
	// return under an explicit show-dismissed request.
	SetInboxShareDismissed(recipientID, ownerID, postingID string, dismissed bool) (InboxShareItem, error)
	// SetInboxShareRead marks an item read or unread. Unread state only
	// changes here: listing, viewing, and deciding never clear it.
	SetInboxShareRead(recipientID, ownerID, postingID string, read bool) (InboxShareItem, error)
	// SetSharingPolicy creates or replaces one member's automatic-sharing
	// preference for one group (GRP-02). Only the owning member may set
	// their own policy: callers must pass the authenticated member's own
	// user ID, so a group administrator cannot force another member's
	// consent. The member must currently belong to the group and every
	// selected account must belong to the member. Enabling with zero
	// accounts is rejected; zero accounts otherwise means no automatic
	// eligibility. Every committed change bumps the policy version for
	// stale-generation fencing.
	SetSharingPolicy(ownerID, groupID string, input SharingPolicyInput) (SharingPolicy, error)
	// GetSharingPolicy returns one member's stored preference. An absent
	// policy reports ErrNotFound and means automatic sharing is off.
	GetSharingPolicy(ownerID, groupID string) (SharingPolicy, error)
	// ListSharingPolicies returns every stored preference for one member.
	ListSharingPolicies(ownerID string) ([]SharingPolicy, error)
	// PreviewSharingPolicy counts the currently eligible postings for one
	// member's stored policy plus the current audience size. Counts only:
	// no amounts, payees, or row IDs leave the owner's scope.
	PreviewSharingPolicy(ownerID, groupID string) (SharingPolicyPreview, error)
	CollectBlobGarbage(ctx context.Context, limit int) error
}
