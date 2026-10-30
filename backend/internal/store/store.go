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
//   - A fresh backend reports DocumentExists() == false. InitializeDocument
//     activates an empty model without replacing existing data.
//   - Clear resets this user's model, sync state (including the Bridge key
//     and card selection), settings, and artifacts. It preserves amount
//     presets, other users, and identity state. Use
//     ClearSyncCredential to disconnect the key while keeping cards.
//   - Missing rows report ErrNotFound (or IsNotFound). Backends must not
//     leak sql.ErrNoRows, missing files, or other mechanism errors.
type Store interface {
	ReceiptStore
	LoadDocument() (*types.FinancialModelDocument, error)
	DocumentExists() (bool, error)
	InitializeDocument() error
	ImportDocument(doc *types.FinancialModelDocument) (*types.FinancialModelDocument, error)
	CreateAccount(account types.Account) (types.Account, error)
	UpdateAccount(account types.Account) (types.Account, error)
	DeleteAccount(id string) error
	MoveAccount(id, beforeID string) error
	// CreateAccountWithBalance stores an account and, when balance is set,
	// its opening balance observation in one transaction. UpdateAccountWithBalance
	// does the same for an account edit plus a moved observation.
	CreateAccountWithBalance(account types.Account, balance *float64, observedOn types.IsoDate) (types.Account, error)
	UpdateAccountWithBalance(account types.Account, balance *float64, observedOn types.IsoDate) (types.Account, error)
	CreatePosting(posting types.Posting) (types.Posting, error)
	UpdatePosting(posting types.Posting) (types.Posting, error)
	DeletePosting(id string) error
	MovePosting(id, beforeID string) error
	// ConvertPostingToRule and ConvertRuleToPosting move one entry
	// across the posting/rule tables in one store transaction, keeping its ID.
	ConvertPostingToRule(postingID string, rule types.RecurrenceRule) (types.RecurrenceRule, error)
	ConvertRuleToPosting(ruleID string, posting types.Posting) (types.Posting, error)
	CreateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error)
	UpdateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error)
	DeleteRule(id string) error
	MoveRule(id, beforeID string) error
	SaveCheckpoint(checkpoint types.Checkpoint) (types.Checkpoint, error)
	DeleteCheckpoint(accountID, date string) error
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
	EnsureSampleUser() (Store, error)
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
	CollectBlobGarbage(ctx context.Context, limit int) error
}
