package store

// Versioned split obligations (SOC-04B). A split records what a group of
// people owes on one shared transaction, independently of financial
// models: creating, revising, or accepting a split never writes transactions,
// checkpoints, or balances, so acceptance moves no money. Settlements
// (SOC-05) and the builder UI (SOC-04C) consume these rows without
// re-deriving shares.
//
// Each change mints a new immutable version row; accepted shares are never
// edited in place. A split starts at version 1 with status proposed. Every
// update appends a version with status proposed and resets acceptances, so
// a previously accepted share only changes through an explicit new
// version. Acceptance is per participant; when every participant of the
// current version has accepted, the version's status becomes accepted.
// Reads resolve the latest version; ListSplitVersions exposes history.
//
// Amounts are integer minor units computed by domain.AllocateSplit
// (SOC-04A): equal shares by default with the remainder to the initiator,
// or caller-supplied overrides that name every participant and sum exactly
// to the total. The store persists the computed shares; it never invents
// them.
//
// Concurrency and retry reuse the social-operation contract (FND-05):
// every mutation carries a client UUID request ID recorded per
// (actor, key) in sharing_requests, replays return the recorded split,
// key reuse across actions fails with ErrSharingConflict, and stale
// expected versions fail explicitly with ErrSharingConflict. Split
// mutations also append identity-only sharing_audit rows (actor, action,
// source target, split link, resulting status, key, time); audit reads stay
// owner-scoped through ListSharingAudit, so there is no audience-side
// split audit read.

// Split lifecycle states. Proposed versions accept changes through new
// versions; accepted versions are terminal records of agreement.
const (
	SplitStatusProposed = "proposed"
	SplitStatusAccepted = "accepted"
)

// Split audit actions recorded in SharingAuditEvent.Action. The event's
// OwnerUserID and TransactionID name the source transaction, LinkID names the
// split, and Status names the resulting split status.
const (
	SharingAuditSplitCreated  = "split-created"
	SharingAuditSplitUpdated  = "split-updated"
	SharingAuditSplitAccepted = "split-accepted"
)

// SplitAllocation is one participant's share of one split version in
// integer minor units. Accepted marks that participant's own acceptance;
// it resets on every new version.
type SplitAllocation struct {
	ParticipantID string `json:"participantId"`
	AmountMinor   int64  `json:"amountMinor"`
	Accepted      bool   `json:"accepted"`
	AcceptedAt    int64  `json:"acceptedAt,omitempty"`
}

// Split is one version of a versioned split obligation. SourceOwnerID plus
// SourceTransactionID names the shared transaction the split divides;
// SourceRevision is the source content hash observed when this version was
// written (FND-04 staleness reference, never parsed). InitiatorID is the
// participant who owns the proposal: only the initiator may revise it.
// Allocations carries every participant's share in stable participant
// order; shares always sum exactly to TotalMinor.
type Split struct {
	ID                  string            `json:"id"`
	SourceOwnerID       string            `json:"sourceOwnerId"`
	SourceTransactionID string            `json:"sourceTransactionId"`
	SourceRevision      string            `json:"sourceRevision"`
	InitiatorID         string            `json:"initiatorId"`
	Currency            string            `json:"currency"`
	TotalMinor          int64             `json:"totalMinor"`
	Version             int64             `json:"version"`
	Status              string            `json:"status"`
	Allocations         []SplitAllocation `json:"allocations"`
	CreatedAt           int64             `json:"createdAt"`
	UpdatedAt           int64             `json:"updatedAt"`
}

// SplitInput describes one split proposal. ParticipantIDs lists the
// initiator plus invitees in stable order; Overrides, when non-empty,
// replaces the equal default and must name an amount for every participant
// summing exactly to TotalMinor. TotalMinor and Currency follow the
// SOC-04A contract: the caller supplies the divided amount, and the store
// persists the computed shares verbatim.
type SplitInput struct {
	SourceOwnerID       string
	SourceTransactionID string
	InitiatorID         string
	Currency            string
	TotalMinor          int64
	ParticipantIDs      []string
	Overrides           map[string]int64
}
