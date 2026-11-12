package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Confirmed transfer pairs. A link wires two detector-ranked opposite legs
// as one movement so flows render it count-once. Legs store normalized
// (leg_a < leg_b, enforced by CHECK) with one membership row per leg; the
// member primary key keeps one leg in at most one link. Transaction and
// finding cascades drop links with the rows they name, so no link ever
// dangles. Fresh databases gain both tables from the shared analysis
// schema; pre-existing databases fail current-schema validation until the
// offline upgrade provisions them. No runtime migration converts old rows.
const analysisTransferLinksDDL = `CREATE TABLE IF NOT EXISTS analysis_transfer_links (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	leg_a TEXT NOT NULL,
	leg_b TEXT NOT NULL CHECK(leg_a < leg_b),
	finding_id TEXT NOT NULL,
	actor TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	PRIMARY KEY(user_id, leg_a, leg_b),
	FOREIGN KEY(user_id, finding_id) REFERENCES analysis_findings(user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, leg_a) REFERENCES transactions(user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, leg_b) REFERENCES transactions(user_id, id) ON DELETE CASCADE
)`

const analysisTransferLinkMembersDDL = `CREATE TABLE IF NOT EXISTS analysis_transfer_link_members (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	transaction_id TEXT NOT NULL,
	leg_a TEXT NOT NULL,
	leg_b TEXT NOT NULL,
	PRIMARY KEY(user_id, transaction_id),
	FOREIGN KEY(user_id, transaction_id) REFERENCES transactions(user_id, id) ON DELETE CASCADE,
	FOREIGN KEY(user_id, leg_a, leg_b) REFERENCES analysis_transfer_links(user_id, leg_a, leg_b) ON DELETE CASCADE
)`

// transferLinkMu serializes link writes within one server instance. Confirm
// and unlink each run in one database transaction; without this, two
// concurrent confirms for overlapping legs could each pass validation and
// interleave their replace writes. The store contract already assumes one
// server and one instance, so a process-wide mutex matches the deployment.
var transferLinkMu sync.Mutex

// transferMatchWindowDays bounds how far apart confirmed legs may post. It
// mirrors the detector rule: both sides of one movement are logged apart,
// so the records can be days apart. Change only with a new product decision.
const transferMatchWindowDays = 7

func sortedTransferLegs(first, second string) (string, string) {
	if second < first {
		return second, first
	}
	return first, second
}

func transferLinkInvalid(reason string) error {
	return fmt.Errorf("%w: %s", store.ErrTransferLinkInvalid, reason)
}

type transferLegEvidence struct {
	model   types.Transaction
	account string
	facts   types.TransactionFacts
	cents   int64
	day     int64
}

// loadTransferLeg reads one leg's current model route plus its saved bank
// evidence in the caller's transaction. A leg without a row belongs to
// another scope (or is gone) and reports ErrNotFound; a leg without saved
// evidence cannot be validated as a detector pair.
func loadTransferLeg(tx *userTx, id string) (transferLegEvidence, error) {
	var leg transferLegEvidence
	rows, err := tx.Query(`SELECT `+transactionSelect+` `+transactionJoins+` WHERE p.id = ? AND p.user_id = :user_id`, id)
	if err != nil {
		return leg, err
	}
	defer rows.Close()
	if !rows.Next() {
		return leg, store.ErrNotFound
	}
	model, err := scanTransactionRow(rows)
	if err != nil {
		return leg, err
	}
	if err := rows.Err(); err != nil {
		return leg, err
	}
	var raw string
	if err := tx.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE transaction_id = ? AND user_id = :user_id`, id).Scan(&raw); err == sql.ErrNoRows {
		return leg, transferLinkInvalid("Both transfer legs need saved bank evidence.")
	} else if err != nil {
		return leg, err
	}
	var facts types.TransactionFacts
	if err := json.Unmarshal([]byte(raw), &facts); err != nil {
		return leg, err
	}
	amount, err := strconv.ParseFloat(facts.Amount, 64)
	if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || math.Abs(amount) > 1e10 || amount == 0 {
		return leg, transferLinkInvalid("Transfer legs must carry a valid non-zero amount.")
	}
	cents := int64(math.Round(math.Abs(amount) * 100))
	if cents == 0 {
		return leg, transferLinkInvalid("Transfer legs must carry a valid non-zero amount.")
	}
	stamp := facts.OccurredAt
	if stamp <= 0 {
		stamp = facts.PostedTime
	}
	if stamp <= 0 {
		return leg, transferLinkInvalid("Both transfer legs need bank timestamps.")
	}
	leg = transferLegEvidence{model: model, facts: facts, cents: cents, day: stamp / 86400}
	if model.SourceAccountID != nil {
		leg.account = *model.SourceAccountID
	} else if len(model.Destinations) > 0 {
		leg.account = model.Destinations[0]
	}
	return leg, nil
}

func invalidTransferPair(first, second transferLegEvidence) error {
	if first.account == "" || second.account == "" || first.account == second.account {
		return transferLinkInvalid("Transfer legs must be on different accounts.")
	}
	if first.model.Pending || first.model.Void || second.model.Pending || second.model.Void {
		return transferLinkInvalid("Both transfer legs must be settled.")
	}
	if first.facts.Currency != "USD" || second.facts.Currency != "USD" {
		return transferLinkInvalid("Both transfer legs must be in USD.")
	}
	if first.cents != second.cents {
		return transferLinkInvalid("Transfer legs must match to the exact cent.")
	}
	firstAmount, _ := strconv.ParseFloat(first.facts.Amount, 64)
	secondAmount, _ := strconv.ParseFloat(second.facts.Amount, 64)
	if (firstAmount < 0) == (secondAmount < 0) {
		return transferLinkInvalid("Transfer pairs need opposite directions: both legs post the same sign, and same-sign pairs are not supported as one movement.")
	}
	// Validation mirrors the netting predicates in domain/flowgraph.go
	// (netConfirmedTransferPairs) and domain/path.go (netLinkedAttempts):
	// only an external outflow paired with an external inflow nets there.
	// Same-route pairs stay split, so confirmation rejects them here instead
	// of writing a link that changes nothing. This runs after the sign check
	// so same-sign pairs keep their specific reason.
	firstOut := domain.IsExternalOutflow(&first.model)
	firstIn := domain.IsExternalInflow(&first.model)
	secondOut := domain.IsExternalOutflow(&second.model)
	secondIn := domain.IsExternalInflow(&second.model)
	if !((firstOut && secondIn) || (firstIn && secondOut)) {
		return transferLinkInvalid("Transfer pairs need one external outflow and one external inflow: same-route pairs stay split and cannot link as one movement.")
	}
	gap := first.day - second.day
	if gap < 0 {
		gap = -gap
	}
	if gap > transferMatchWindowDays {
		return transferLinkInvalid("Transfer legs must post within 7 days of each other.")
	}
	return nil
}

func scanTransferLink(row interface{ Scan(...any) error }) (types.TransferLink, error) {
	var link types.TransferLink
	err := row.Scan(&link.LegA, &link.LegB, &link.FindingID, &link.Actor, &link.CreatedAt)
	return link, err
}

// ConfirmTransferPair wires one detector-ranked opposite-leg pair as a single
// transfer: it validates both legs, replaces any active link touching either
// leg, and records analysis feedback acceptance for the finding in the same
// transaction. Confirming the same pair again returns the same link.
func (s *sqliteStore) ConfirmTransferPair(findingID, peerTransactionID, actor string) (types.TransferLink, error) {
	transferLinkMu.Lock()
	defer transferLinkMu.Unlock()
	var link types.TransferLink
	tx, err := s.db.Begin()
	if err != nil {
		return link, err
	}
	defer tx.Rollback()
	var detectionJSON, reviewJSON, status string
	var analysisType string
	var runID string
	var feedbackRevision int64
	var dismissed bool
	err = tx.QueryRow(`SELECT f.detection_json, f.run_id, f.review_json, f.feedback_revision, f.dismissed, f.status, f.analysis_type
		FROM analysis_findings f WHERE f.id = ? AND f.user_id = :user_id`, findingID).Scan(
		&detectionJSON, &runID, &reviewJSON, &feedbackRevision, &dismissed, &status, &analysisType)
	if err == sql.ErrNoRows {
		return link, store.ErrNotFound
	}
	if err != nil {
		return link, err
	}
	if analysisType != "transfer" {
		return link, transferLinkInvalid("This finding is not a transfer pair.")
	}
	if status != "active" {
		return link, transferLinkInvalid("This finding is no longer active.")
	}
	if dismissed {
		return link, transferLinkInvalid("This finding is dismissed. Restore it to confirm a pair.")
	}
	var detection types.AnalysisDetection
	if err := json.Unmarshal([]byte(detectionJSON), &detection); err != nil {
		return link, err
	}
	candidate := false
	if len(detection.Evidence) > 0 {
		for _, id := range detection.Evidence[0].TransactionIDs {
			if id == peerTransactionID {
				candidate = true
				break
			}
		}
	}
	if !candidate {
		return link, transferLinkInvalid("The selected transaction is not a detector-ranked candidate for this finding.")
	}
	first, err := loadTransferLeg(tx, detection.TransactionID)
	if err != nil {
		return link, err
	}
	second, err := loadTransferLeg(tx, peerTransactionID)
	if err != nil {
		return link, err
	}
	if err := invalidTransferPair(first, second); err != nil {
		return link, err
	}
	legA, legB := sortedTransferLegs(detection.TransactionID, peerTransactionID)
	existing, err := scanTransferLink(tx.QueryRow(`SELECT leg_a, leg_b, finding_id, actor, created_at FROM analysis_transfer_links WHERE leg_a = ? AND leg_b = ? AND user_id = :user_id`, legA, legB))
	if err == nil {
		if existing.FindingID == findingID {
			return existing, nil
		}
	} else if err != sql.ErrNoRows {
		return link, err
	}
	if _, err := tx.Exec(`DELETE FROM analysis_transfer_links WHERE user_id = :user_id AND (leg_a = ? OR leg_b = ? OR leg_a = ? OR leg_b = ?)`, detection.TransactionID, detection.TransactionID, peerTransactionID, peerTransactionID); err != nil {
		return link, err
	}
	now := time.Now().Unix()
	if actor == "" {
		actor = tx.userID
	}
	if _, err := tx.Exec(`INSERT INTO analysis_transfer_links(leg_a, leg_b, finding_id, actor, created_at, user_id) VALUES (?, ?, ?, ?, ?, :user_id)`, legA, legB, findingID, actor, now); err != nil {
		return link, err
	}
	for _, leg := range []string{legA, legB} {
		if _, err := tx.Exec(`INSERT INTO analysis_transfer_link_members(transaction_id, leg_a, leg_b, user_id) VALUES (?, ?, ?, :user_id)
			ON CONFLICT(user_id, transaction_id) DO UPDATE SET leg_a = excluded.leg_a, leg_b = excluded.leg_b`, leg, legA, legB); err != nil {
			return link, err
		}
	}
	var review *types.AnalysisReview
	if err := json.Unmarshal([]byte(reviewJSON), &review); err != nil {
		return link, err
	}
	if review == nil || review.Decision != "confirmed" {
		requestID, err := newRowID()
		if err != nil {
			return link, err
		}
		if _, err := applyAnalysisFeedback(tx, findingID, types.AnalysisFeedbackInput{
			RequestID: requestID, RunID: runID, Revision: feedbackRevision, Action: "confirm", Actor: actor,
		}, true); err != nil {
			return link, err
		}
	}
	link = types.TransferLink{LegA: legA, LegB: legB, FindingID: findingID, Actor: actor, CreatedAt: now}
	if err := tx.Commit(); err != nil {
		return types.TransferLink{}, err
	}
	return link, nil
}

// RemoveTransferLinkByLeg deletes the active link touching one leg. A leg
// with no active link reports ErrNotFound.
func (s *sqliteStore) RemoveTransferLinkByLeg(transactionID string) (types.TransferLink, error) {
	transferLinkMu.Lock()
	defer transferLinkMu.Unlock()
	var link types.TransferLink
	tx, err := s.db.Begin()
	if err != nil {
		return link, err
	}
	defer tx.Rollback()
	var legA, legB string
	if err := tx.QueryRow(`SELECT leg_a, leg_b FROM analysis_transfer_link_members WHERE transaction_id = ? AND user_id = :user_id`, transactionID).Scan(&legA, &legB); err == sql.ErrNoRows {
		return link, store.ErrNotFound
	} else if err != nil {
		return link, err
	}
	link, err = scanTransferLink(tx.QueryRow(`SELECT leg_a, leg_b, finding_id, actor, created_at FROM analysis_transfer_links WHERE leg_a = ? AND leg_b = ? AND user_id = :user_id`, legA, legB))
	if err == sql.ErrNoRows {
		return types.TransferLink{}, store.ErrNotFound
	}
	if err != nil {
		return types.TransferLink{}, err
	}
	if _, err := tx.Exec(`DELETE FROM analysis_transfer_links WHERE leg_a = ? AND leg_b = ? AND user_id = :user_id`, legA, legB); err != nil {
		return types.TransferLink{}, err
	}
	return link, tx.Commit()
}

// ListTransferLinks returns every active confirmed pair in leg order.
func (s *sqliteStore) ListTransferLinks() ([]types.TransferLink, error) {
	rows, err := s.db.Query(`SELECT leg_a, leg_b, finding_id, actor, created_at FROM analysis_transfer_links WHERE user_id = :user_id ORDER BY leg_a, leg_b`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := []types.TransferLink{}
	for rows.Next() {
		link, err := scanTransferLink(rows)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(links, func(i, j int) bool {
		if links[i].LegA != links[j].LegA {
			return links[i].LegA < links[j].LegA
		}
		return links[i].LegB < links[j].LegB
	})
	return links, nil
}
