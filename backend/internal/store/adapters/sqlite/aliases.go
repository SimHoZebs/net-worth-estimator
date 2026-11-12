package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Type aliases let the SQLite implementation satisfy the store ports
// without rewriting every signature. The canonical definitions live in
// the store package; this package owns only SQL, files, and driver details.
type (
	SyncCredential       = store.SyncCredential
	SyncCheckpoint       = store.SyncCheckpoint
	SyncCheckpointKey    = store.SyncCheckpointKey
	SyncApplySummary     = store.SyncApplySummary
	SyncProvision        = store.SyncProvision
	SyncTransaction      = store.SyncTransaction
	BankKey              = store.BankKey
	BankRow              = store.BankRow
	BankDirective        = store.BankDirective
	BankUpsert           = store.BankUpsert
	BankConvert          = store.BankConvert
	BankObservation      = store.BankObservation
	Group                = store.Group
	GroupMember          = store.GroupMember
	GroupInvite          = store.GroupInvite
	Friend               = store.Friend
	AccountLink          = store.AccountLink
	EvaluationUpdate     = store.EvaluationUpdate
	GeneratedTransaction = store.GeneratedTransaction
	ProjectionRowPayload = store.ProjectionRowPayload
)

const (
	SourceUser          = store.SourceUser
	SourceBankSync      = store.SourceBankSync
	ProviderSimpleFIN   = store.ProviderSimpleFIN
	LinkOriginManual    = store.LinkOriginManual
	LinkOriginAuto      = store.LinkOriginAuto
	GroupRoleOwner      = store.GroupRoleOwner
	GroupRoleAdmin      = store.GroupRoleAdmin
	GroupRoleMember     = store.GroupRoleMember
	ReceiptStorageLimit = store.ReceiptStorageLimit
)

var (
	ErrGroupForbidden    = store.ErrGroupForbidden
	ErrGroupInvalid      = store.ErrGroupInvalid
	ErrReceiptNotFound   = store.ErrReceiptNotFound
	ErrReceiptConflict   = store.ErrReceiptConflict
	ErrReceiptDuplicate  = store.ErrReceiptDuplicate
	ErrReceiptIneligible = store.ErrReceiptIneligible
	ErrReceiptQuota      = store.ErrReceiptQuota
	ErrNotFound          = store.ErrNotFound

	IsNotFound       = store.IsNotFound
	IsIDConflict     = store.IsIDConflict
	IsInvalidID      = store.IsInvalidID
	IsSyncOwned      = store.IsSyncOwned
	IsAccountMissing = store.IsAccountMissing

	ValidateAmountPresetName      = store.ValidateAmountPresetName
	ModelETag                     = store.ModelETag
	TransactionReceiptFingerprint = store.TransactionReceiptFingerprint
	NotFound                      = store.NotFound
	IDConflict                    = store.IDConflict
	InvalidID                     = store.InvalidID
	SyncOwned                     = store.SyncOwned
	AccountMissing                = store.AccountMissing
)
