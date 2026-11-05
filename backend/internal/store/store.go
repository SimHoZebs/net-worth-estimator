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
//     and card selection), Gmail OAuth state (tokens, account, cursor),
//     settings, and artifacts. It preserves amount presets, other users,
//     and identity state. Use
//     ClearSyncCredential to disconnect the key while keeping cards.
//   - Missing rows report ErrNotFound (or IsNotFound). Backends must not
//     leak sql.ErrNoRows, missing files, or other mechanism errors.
type Store interface {
	ReceiptStore
	AnalysisStore
	CategoryStore
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
	// SupersedeAccount retires one manual account in favor of the synced
	// account linked to bridgeAccountID. The synced account inherits the
	// manual account's profile and account-scoped configuration, while its
	// bank rows and bridge link stay authoritative. The manual account, its
	// postings, and its checkpoints are deleted in the same transaction. A
	// candidate that fails model validation is not persisted and reports
	// Issues. The exact bridge link is rechecked inside the transaction.
	SupersedeAccount(manualAccountID, syncedAccountID, bridgeAccountID string) (AccountSupersedeResult, error)
	CreatePosting(posting types.Posting) (types.Posting, error)
	UpdatePosting(posting types.Posting) (types.Posting, error)
	// SetPostingClaims replaces occurrence claims for the named postings in
	// one transaction. It touches only posting_claims (plus pending clearing
	// when a pending bank row becomes a claimed occurrence) so concurrent
	// name or amount edits never lose data.
	SetPostingClaims(claims []types.PostingClaimUpdate) ([]types.Posting, error)
	DeletePosting(id string) error
	MovePosting(id, beforeID string) error
	CreatePlannedPurchase(purchase types.PlannedPurchase) (types.PlannedPurchase, error)
	UpdatePlannedPurchase(purchase types.PlannedPurchase) (types.PlannedPurchase, error)
	DeletePlannedPurchase(id string) error
	MovePlannedPurchase(id, beforeID string) error
	// CreateScheduleClaimingPosting creates a schedule and records an
	// existing transaction as its first occurrence, atomically.
	CreateScheduleClaimingPosting(schedule types.Schedule, postingID, occurrenceDate string) (types.Schedule, error)
	// DeleteScheduleCreatingPosting records the one-time transaction that
	// happened and removes the schedule, atomically.
	DeleteScheduleCreatingPosting(scheduleID string, posting types.Posting) (types.Posting, error)
	CreateSchedule(rule types.Schedule) (types.Schedule, error)
	UpdateSchedule(rule types.Schedule) (types.Schedule, error)
	DeleteSchedule(id string) error
	MoveSchedule(id, beforeID string) error
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
	// ListSyncAccountKeys reports every distinct provider account key stored
	// in sync rows, including rows whose account link was removed.
	ListSyncAccountKeys(provider string) ([]string, error)
	ProvisionSyncAccounts(items []SyncProvision) (map[string]string, int, []string, error)
	GetSyncCredential() (SyncCredential, error)
	SetSyncCredential(accessURL, bridgeHost string) (SyncCredential, error)
	ClearSyncCredential() error
	GetSyncCards() ([]string, error)
	SetSyncCards(cards []string) ([]string, error)
	GetLastSyncTime() (string, error)
	SetLastSyncTime(completedAt string) error
	// SetSyncError records the last sync condition worth showing. A
	// success with no notices clears it.
	SetSyncError(item SyncError) error
	GetSyncError() (*SyncError, error)
	ClearSyncError() error
	// GetGmailCredential reports the stored Gmail OAuth state, or a
	// disconnected credential with DefaultGmailLookbackDays when no
	// connection has been stored. Secrets stay in the row.
	GetGmailCredential() (GmailCredential, error)
	// ConnectGmail stores a Gmail OAuth grant: refresh and access
	// tokens, the consented account, and the granted scopes. It stamps
	// the connection time and clears any pending authorization state.
	ConnectGmail(grant GmailCredential) (GmailCredential, error)
	// UpdateGmailToken replaces the stored access token after a
	// server-side refresh. A non-empty refresh token rotates the stored
	// grant; an empty one keeps the existing refresh token.
	UpdateGmailToken(accessToken string, accessExpiryUnix int64, refreshToken string) (GmailCredential, error)
	// SetGmailLookback stores the configurable initial scan lookback in
	// days. Callers validate the range; the store persists it.
	SetGmailLookback(days int) (GmailCredential, error)
	// SetGmailScanCursor records the incremental scan cursor after a
	// completed scan (INT-03). History ID and completion time persist
	// together so a scan never resumes from a half-written cursor.
	SetGmailScanCursor(historyID, scannedAt string) (GmailCredential, error)
	// SetGmailPendingState records the in-flight OAuth CSRF state.
	SetGmailPendingState(state string, pendingAtUnix int64) error
	// ClearGmailCredential disconnects Gmail: tokens, account display,
	// and scan cursor are forgotten. The lookback preference is kept so
	// a reconnect resumes with the user's window.
	ClearGmailCredential() error
	// SaveEmailReceipt records one triaged Gmail message. The Gmail
	// message ID dedupes repeat scans: a repeat save keeps the first
	// extraction and any user correction, never a duplicate row. An
	// empty ID receives a server-generated value.
	SaveEmailReceipt(receipt EmailReceipt) (EmailReceipt, error)
	// IsGmailMessageScanned reports whether a Gmail message already has
	// a stored triage row, so repeat scans skip it without refetching.
	IsGmailMessageScanned(messageID string) (bool, error)
	// ListEmailReceipts returns stored email receipts in ID order,
	// optionally filtered by verdict and status with cursor pagination.
	ListEmailReceipts(filter EmailReceiptFilter) ([]EmailReceipt, error)
	// GetEmailReceipt reads one stored email receipt by ID.
	GetEmailReceipt(id string) (EmailReceipt, error)
	// ReviewEmailReceipt confirms or corrects one extraction. The
	// correction overlays the original values and marks the row
	// confirmed; a nil correction confirms the extraction as-is. The
	// original extraction and provenance are preserved.
	ReviewEmailReceipt(id string, correction *EmailReceiptCorrection) (EmailReceipt, error)
	ApplySync(checkpoints []SyncCheckpoint, directives []BankDirective) (SyncApplySummary, error)
	LoadBankPostings() ([]BankRow, error)
	// Unified projection state: single dirty date plus slice manifest.
	GetProjectionState() (types.ProjectionState, error)
	SaveProjectionState(state types.ProjectionState) (types.ProjectionState, error)
	MarkProjectionDirty(dirtyFrom int64) (types.ProjectionState, error)
	PublishProjection(revision int64) (types.ProjectionState, error)
	ListProjectionSlices() ([]types.ProjectionSlice, error)
	SaveProjectionSlice(slice types.ProjectionSlice) (types.ProjectionSlice, error)
	DeleteProjectionSlicesFrom(fromAt int64) error
	ListMonteCarloStatistics(sliceID string) ([]types.MonteCarloStatistic, error)
	SaveMonteCarloStatistics(stats []types.MonteCarloStatistic) error
	DeleteMonteCarloStatistics(sliceIDs []string) error
	// SaveGeneratedPostings replaces every touched slice's stored
	// engine-output transactions atomically. Generated rows never enter
	// model reads: every model query filters them by null slice.
	SaveGeneratedPostings(rows []GeneratedPosting) error
	// SaveDeterministicEvaluations records the deterministic evaluation
	// fingerprint for one revision without touching revision or dirty
	// bookkeeping. Reports false when a newer write already moved the
	// revision, so the caller can skip publishing a stale build.
	SaveDeterministicEvaluations(stateID string, revision int64, evalJSON string) (bool, error)
	ListGeneratedPostings(sliceIDs []string) ([]GeneratedPosting, error)
	DeleteGeneratedPostings(sliceIDs []string) error
	SaveProjectionRows(rows []ProjectionRowPayload) error
	ListProjectionRows(sliceIDs []string) ([]ProjectionRowPayload, error)
	DeleteProjectionRows(sliceIDs []string) error
	// Each evaluation persists in its own table with typed result columns.
	// Variable-length evidence stays verbatim JSON. Reader evals and
	// simulator evals persist separately by kind.
	SaveNetWorthThresholdOutputs(stateID, kind string, outputs []types.NetWorthThresholdOutput, builtRevision int64) error
	ListNetWorthThresholdOutputs(stateID, kind string) ([]types.NetWorthThresholdOutput, error)
	SaveAccountBalanceOutputs(stateID, kind string, outputs []types.AccountBalanceOutput, builtRevision int64) error
	ListAccountBalanceOutputs(stateID, kind string) ([]types.AccountBalanceOutput, error)
	SavePostingFulfillmentOutputs(stateID, kind string, outputs []types.PostingFulfillmentOutput, builtRevision int64) error
	ListPostingFulfillmentOutputs(stateID, kind string) ([]types.PostingFulfillmentOutput, error)
	SaveCycleFulfillmentOutputs(stateID, kind string, outputs []types.CycleFulfillmentOutput, builtRevision int64) error
	ListCycleFulfillmentOutputs(stateID, kind string) ([]types.CycleFulfillmentOutput, error)
	SavePlannedPurchasesOutputs(stateID, kind string, outputs []types.PlannedPurchasesOutput, builtRevision int64) error
	ListPlannedPurchasesOutputs(stateID, kind string) ([]types.PlannedPurchasesOutput, error)
	SaveFinancialIndependenceOutputs(stateID, kind string, outputs []types.FinancialIndependenceOutput, builtRevision int64) error
	ListFinancialIndependenceOutputs(stateID, kind string) ([]types.FinancialIndependenceOutput, error)
	SaveWhatIfOutputs(stateID, kind string, outputs []types.WhatIfOutput, builtRevision int64) error
	ListWhatIfOutputs(stateID, kind string) ([]types.WhatIfOutput, error)
	ListProviderConnections() ([]types.ProviderConnection, error)
	SaveProviderConnection(conn types.ProviderConnection) (types.ProviderConnection, error)
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
	ListFriends(userID, search string) ([]Friend, error)
	GetFriend(userID, friendID string) (Friend, error)
	AreFriends(userID, friendID string) (bool, error)
	TouchFriendDisplay(userID, displayName string)
	TouchMemberDisplay(userID, displayName string)
	RemoveGroupMembershipsForUser(userID string) error
	// GrantSharedPosting records the owner's explicit decision to share one
	// of their postings with one audience (a user or a group). Only the
	// source owner may grant; callers must pass the authenticated owner's
	// own user ID. A grant for an audience with an active exclusion is
	// rejected until the exclusion is removed. requestID is a
	// client-generated UUID: a retry replays the recorded grant without
	// re-executing, while a key reused for a different action or target
	// fails with ErrSharingConflict. Failed attempts never consume the
	// key. Every committed grant appends one sharing_audit row carrying
	// the request key in its detail payload.
	GrantSharedPosting(ownerID, postingID, audienceType, audienceID, requestID string) (SharingGrant, error)
	// RevokeSharedPosting deletes one explicit grant. Subsequent reads deny
	// access unless another independent valid grant survives. requestID
	// carries the grant idempotency contract: a retry replays the recorded
	// revocation instead of reporting the now-missing grant.
	RevokeSharedPosting(ownerID, postingID, audienceType, audienceID, requestID string) error
	// ExcludeSharedPosting records the owner's explicit exclusion of one
	// audience for one posting, including a wildcard (audience "all") that
	// covers current and future audiences. An audience with an active grant
	// cannot be excluded until the grant is revoked. Exclusions are
	// idempotent. A user exclusion denies that person even through group
	// grants; other group members stay authorized. requestID carries the
	// grant idempotency contract.
	ExcludeSharedPosting(ownerID, postingID, audienceType, audienceID, requestID string) (SharingGrant, error)
	// RemoveSharedExclusion deletes one explicit exclusion. requestID
	// carries the grant idempotency contract: a retry replays the recorded
	// removal.
	RemoveSharedExclusion(ownerID, postingID, audienceType, audienceID, requestID string) error
	// ListSharingGrants returns the owner's explicit grants and exclusions.
	ListSharingGrants(ownerID string) ([]SharingGrant, error)
	// CheckSharedPostingAccess evaluates read-time authorization for one
	// owner-scoped posting and requester: current group and source-owner
	// membership, owner consent (explicit grant or enabled automatic-sharing
	// policy covering the posting's current accounts and transaction date),
	// exclusions, and revocation state. It queries current rows on every call;
	// there is no positive auth cache and no materialized index shortcut:
	// the visibility index only discovers list candidates, while this
	// function alone decides every list and detail read from live rows.
	CheckSharedPostingAccess(ownerID, postingID, requesterID string) (SharedPostingAccess, error)
	// ReadSharedPosting returns the owner's posting in the existing
	// transaction shape when the requester is currently authorized. Missing
	// and denied postings both report ErrNotFound so existence is not
	// enumerable. It never exposes accounts, balances, models, secrets,
	// or receipts.
	ReadSharedPosting(ownerID, postingID, requesterID string) (types.Posting, error)
	// ListSharedPostings returns every posting currently shared with the
	// requester, each in the existing transaction shape with its owner.
	// Automatic discovery reads the write-maintained visibility index at
	// the current policy version, ordered by owner then posting; one
	// posting lists once however many accounts, groups, or reasons match.
	ListSharedPostings(requesterID string) ([]SharedPostingRef, error)
	// RebuildSharingIndex re-derives one owner's whole visibility index
	// from live policies and postings in one transaction for operator
	// recovery. Normal writes maintain the index incrementally; a rebuild
	// only lands live-covered postings for current memberships, so it
	// never over-shares.
	RebuildSharingIndex(ownerID string) error
	// CopySharedPosting accepts one authorized shared posting into the
	// requester's own private model as an independent row: new ID,
	// recipient ownership, no claim, and no remote coupling. The copy is
	// owner-authored (SourceUser, never pending or void) with no bank sync
	// key, so accepting a share never manufactures a duplicate bank
	// posting. Copies are idempotent per source-plus-recipient triple:
	// repeat accepts return the existing recipient row, with its edits
	// intact, instead of minting duplicates. requestID is a
	// client-generated UUID: retries with the same key replay the recorded
	// copy, while a key reused for a different action or target fails with
	// ErrSharingConflict. A source revision landing mid-accept fails with
	// ErrSharingConflict and rolls the copy back instead of recording a
	// torn link; a concurrent accept losing the link-identity race resolves
	// to the winner's copy. Every copy records its
	// stable link identity (FND-04) and appends one copy-accepted audit row
	// carrying the link and the request key. Later revocation never rewrites or
	// erases the copy. Source-original writes by another member stay
	// deferred (no such path exists).
	CopySharedPosting(ownerID, postingID, requesterID, requestID string) (types.Posting, error)
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
	// survive refresh, revocation, and source deletion alike. requestID is
	// a client-generated UUID: a retry replays the recorded outcome, and
	// each committed refresh appends one link-refreshed audit row carrying
	// the link, the outcome status, and the request key. See
	// SharingLinkRefresh for the status contract.
	RefreshSharingLink(recipientID, copyPostingID, requestID string) (SharingLinkRefresh, error)
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
	// ListSharingAudit returns the committed cross-user changes for one
	// owner-scoped posting in sequence order: consent rows (grant, revoke,
	// exclude, unexclude), accepted-copy and link-refresh rows, and
	// split-created, split-updated, and split-accepted rows. Callers must
	// pass the source owner's own user ID: audit reads are owner-scoped
	// like grant lists, with no audience-side read. Events carry actor,
	// action, target identities, link, outcome status, request key, and
	// time only, never transaction evidence. Link, status, and key decode
	// from the audit detail payload; actions that name none leave them
	// empty.
	ListSharingAudit(ownerID, postingID string) ([]SharingAuditEvent, error)
	// CreateSplit persists version 1 of a split obligation dividing one
	// shared transaction across its participants. The actor must be the
	// initiator, and every participant (initiator included) must hold
	// current shared-posting access to the source; anything else fails
	// closed without revealing who holds access. Shares come from
	// domain.AllocateSplit over the caller's total, currency, participants,
	// and overrides. requestID is a client-generated UUID: a retry with the
	// same key replays the recorded split, while the same key naming a
	// different action or target fails with ErrSharingConflict. One key
	// creates one split per source posting: a second, intentionally
	// different split needs a fresh key. The recorded source revision names
	// the source content the version divides. Split writes never touch
	// postings, checkpoints, or balances.
	CreateSplit(actorID string, input SplitInput, requestID string) (Split, error)
	// UpdateSplit appends a new version to a split with status proposed and
	// reset acceptances; accepted shares only change through this explicit
	// version step, never by silent edit. Only the initiator may revise,
	// and expectedVersion must name the current version or the update fails
	// with ErrSharingConflict. Every participant of the new version must
	// hold current source access, and shares are recomputed by
	// domain.AllocateSplit. requestID carries the CreateSplit idempotency
	// contract against the split link; a replay additionally requires the
	// caller's expected version to be the recorded version's predecessor,
	// so a new attempt reusing a key conflicts instead of replaying stale
	// history.
	UpdateSplit(actorID, splitID string, expectedVersion int64, input SplitInput, requestID string) (Split, error)
	// AcceptSplit records the actor's own acceptance of the current split
	// version. The actor must be a participant of that version and
	// expectedVersion must name the current version; accepting a
	// superseded version fails with ErrSharingConflict. When every
	// participant has accepted, the version's status becomes accepted.
	// Acceptance writes no postings, checkpoints, or balances: it moves no
	// money. requestID carries the CreateSplit idempotency contract
	// against the split link; a replay additionally requires the caller's
	// expected version to equal the recorded version.
	AcceptSplit(actorID, splitID string, expectedVersion int64, requestID string) (Split, error)
	// GetSplit returns the latest version of one split. The requester must
	// be the initiator or a participant of that version; anyone else
	// receives ErrNotFound so split membership is not enumerable. Reads
	// perform no live source authorization check: the split is the
	// participants' own obligation record and survives source edits,
	// revocation, and source deletion, mirroring accepted-copy provenance.
	GetSplit(requesterID, splitID string) (Split, error)
	// ListSplits returns the latest version of every split where the
	// requester is initiator or participant, in stable order.
	ListSplits(requesterID string) ([]Split, error)
	// ListSplitVersions returns every version of one split in ascending
	// version order, including superseded and accepted history. Access
	// matches GetSplit.
	ListSplitVersions(requesterID, splitID string) ([]Split, error)
	// RecordSettlement appends one payoff record against one
	// participant's share of one split (SOC-05). The actor and the
	// participant must be provisioned users; the split ID must be a
	// canonical UUID. The amount must be positive. An optional link to
	// one real payment (owner plus posting) must name both halves or
	// neither, and one real payment backs at most one settlement, so a
	// linked payment is never double-counted. requestID is a
	// client-generated UUID: a retry with the same key replays the
	// recorded settlement, while the same key naming a different
	// settlement fails with ErrSettlementConflict. The write touches
	// only settlement rows: it never writes postings, checkpoints,
	// accounts, or balances, so recording a settlement moves no money.
	// Split-membership fencing (only current split participants may
	// record and read) lands with the SOC-04B split reads; until then
	// the split ID is opaque and any provisioned user may record.
	RecordSettlement(actorID string, input SettlementInput, requestID string) (Settlement, error)
	// ListSettlements returns the append-only settlement history for one
	// split in record order. Unknown splits report an empty history.
	// Split-membership fencing lands with the SOC-04B split reads;
	// until then any provisioned user may read.
	ListSettlements(requesterID, splitID string) ([]Settlement, error)
	// PreviewSharingPolicyDraft counts the currently eligible postings for
	// unsaved preference values plus the current audience size, without
	// persisting anything (GRP-04 consent preview). Counts are computed
	// as if the draft were enabled; the echoed Enabled flag stays as
	// submitted. Counts only: no amounts, payees, or row IDs leave the
	// owner's scope. Non-members report ErrNotFound.
	PreviewSharingPolicyDraft(ownerID, groupID string, input SharingPolicyInput) (SharingPolicyPreview, error)
	// ListGroupSharedFeed returns the per-group shared transaction feed
	// (GRP-03): every posting the requester is currently authorized to
	// read that belongs in the named group, each listed once however
	// many group grants, policies, accounts, or direct shares match.
	// Candidates come from the indexed references plus the explicit
	// manual grants, and every candidate passes CheckSharedPostingAccess
	// before it is read, so a stale reference under-shares but never
	// over-shares. A posting belongs in the group feed when the viewer
	// reaches it through the group (manual group grant or automatic
	// policy) or through a direct share from one of the group's current
	// members. Non-members and unknown groups report ErrNotFound so
	// group visibility is not enumerable. Results order by owner then
	// posting; keyset feed pagination over the result belongs to the
	// HTTP consumer.
	ListGroupSharedFeed(requesterID, groupID string) ([]GroupFeedItem, error)
	CollectBlobGarbage(ctx context.Context, limit int) error
}
