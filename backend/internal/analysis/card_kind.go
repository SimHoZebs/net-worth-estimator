package analysis

import (
	"context"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// CardKindVersion versions the card-kind detector. A change to the issuer
// catalog, the type list, or the balance rule belongs in a new version so a
// recheck refreshes unchanged evidence.
const CardKindVersion = "card-kind-v1"

type CardKind struct{}

func (CardKind) Type() string    { return "card-kind" }
func (CardKind) Version() string { return CardKindVersion }

// cardIssuer follows the BNPL provider catalog pattern: a stable list of
// recognized identities, not a branch in the detector. Keys are normalized
// merchant keys, the same normalization bank descriptors use in payment
// streams. An issuer name is a name signal only and never decides alone.
type cardIssuer struct {
	id  string
	key string
}

var cardIssuers = []cardIssuer{
	{id: "chase", key: "chase"},
	{id: "citi", key: "citi"},
	{id: "capital-one", key: "capital"},
	{id: "american-express", key: "amex"},
	{id: "american-express", key: "american"},
	{id: "visa", key: "visa"},
	{id: "mastercard", key: "mastercard"},
	{id: "discover", key: "discover"},
	{id: "wells-fargo", key: "wells"},
	{id: "barclays", key: "barclays"},
	{id: "synchrony", key: "synchrony"},
	{id: "ally", key: "ally"},
}

var cardIssuerByKey = func() map[string]string {
	byKey := make(map[string]string, len(cardIssuers))
	for _, issuer := range cardIssuers {
		if _, exists := byKey[issuer.key]; !exists {
			byKey[issuer.key] = issuer.id
		}
	}
	return byKey
}()

// cardExtraTypes are the bridge's own type hints that name a card. They are
// source-supplied types, not labels we infer, and remain non-name signals.
var cardExtraTypes = map[string]bool{
	"card":        true,
	"credit_card": true,
	"creditcard":  true,
	"charge_card": true,
	"chargecard":  true,
	"revolving":   true,
}

func normalizeCardExtraType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.NewReplacer("-", "_", " ", "_").Replace(value)
}

// cardIssuerFor reports the catalog issuer named by the bridge account name or
// institution. The account name is a name signal, so this result only
// corroborates a non-name signal.
func cardIssuerFor(account types.AnalysisAccount) (string, bool) {
	for _, text := range []string{account.Name, account.Institution} {
		key := domain.NormalizedMerchantKey(text)
		if key == "" {
			continue
		}
		if id, ok := cardIssuerByKey[key]; ok {
			return id, true
		}
	}
	return "", false
}

const cardKindBasisLimit = 50

func cardKindAnchor(transactions []types.AnalysisTransaction) (string, []string) {
	ids := make([]string, 0, len(transactions))
	for _, transaction := range transactions {
		ids = append(ids, transaction.TransactionID)
	}
	sort.Strings(ids)
	if len(ids) > cardKindBasisLimit {
		ids = ids[:cardKindBasisLimit]
	}
	return ids[0], ids
}

// Analyze emits at most one finding per candidate account. A candidate needs
// at least one non-name signal: the bridge's own card type hint or debt-like
// balance behavior. The declared account kind stays authoritative; an account
// already declared a credit card needs no suggestion. The finding anchors to
// one of the account's bank transactions so it reuses the existing findings
// table, claim, withdraw, stale, dismissal, and feedback behavior unchanged.
// Dismissal persists across runs for the same anchor. Deleting the anchor
// transaction deletes the finding row with it, so a later run re-anchors and
// re-suggests; that reappearance reflects changed evidence, not a lost
// dismissal.
func (CardKind) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	byAccount := make(map[string][]types.AnalysisTransaction)
	for _, transaction := range input.Transactions {
		if transaction.AccountID == "" {
			continue
		}
		byAccount[transaction.AccountID] = append(byAccount[transaction.AccountID], transaction)
	}
	findings := []types.AnalysisDetection{}
	for _, account := range input.Accounts {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		transactions := byAccount[account.AccountID]
		if len(transactions) == 0 || normalizeCardExtraType(account.Kind) == "credit_card" {
			continue
		}
		bridgeCard := cardExtraTypes[normalizeCardExtraType(account.ExtraType)]
		debtLike := account.DebtLike
		if !bridgeCard && !debtLike {
			continue
		} // An issuer name alone never decides.
		issuer, hasIssuer := cardIssuerFor(account)
		anchor, basis := cardKindAnchor(transactions)
		evidence := make([]types.AnalysisEvidence, 0, 3)
		if bridgeCard {
			evidence = append(evidence, types.AnalysisEvidence{
				Code:           "card-kind.bridge-type",
				Reason:         "The bank bridge reports this account's type as a card.",
				TransactionIDs: basis,
			})
		}
		if debtLike {
			evidence = append(evidence, types.AnalysisEvidence{
				Code:           "card-kind.debt-balance",
				Reason:         "The bank-reported balance behaves like card debt: an amount owed with credit still available.",
				TransactionIDs: basis,
			})
		}
		if hasIssuer {
			evidence = append(evidence, types.AnalysisEvidence{
				Code:           "card-kind.issuer-name",
				Reason:         "The account name matches a known card issuer.",
				TransactionIDs: []string{anchor},
			})
		}
		linkedID := account.LinkedID
		if linkedID == "" {
			linkedID = account.AccountID
		}
		strength := "moderate"
		if bridgeCard && debtLike {
			strength = "strong"
		}
		findings = append(findings, types.AnalysisDetection{
			TransactionID: anchor,
			AccountID:     linkedID,
			Kind:          "card-kind",
			Provider:      issuer,
			Strength:      strength,
			Evidence:      evidence,
		})
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].AccountID < findings[j].AccountID })
	return findings, nil
}
