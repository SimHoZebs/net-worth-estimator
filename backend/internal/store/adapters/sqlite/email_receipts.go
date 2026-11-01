package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// emailReceiptsDDL owns the per-user Gmail receipt-discovery evidence
// (INT-03). Fresh databases get it from the shared schema; existing
// databases self-heal through ensureEmailReceipts at first use, so no
// operator migration converts anything. Every scanned message keeps one
// row keyed by Gmail message ID: receipt-like mail carries extracted
// evidence, ordinary and shipping-only mail keep the identity and verdict
// only so repeat scans dedupe without retaining mail content. Message
// bodies and snippets are never persisted.
const emailReceiptsDDL = `CREATE TABLE IF NOT EXISTS email_receipts (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	gmail_message_id TEXT NOT NULL,
	thread_id TEXT NOT NULL DEFAULT '',
	from_address TEXT NOT NULL DEFAULT '',
	subject TEXT NOT NULL DEFAULT '',
	message_date TEXT NOT NULL DEFAULT '',
	verdict TEXT NOT NULL,
	merchant TEXT NOT NULL DEFAULT '',
	receipt_date TEXT NOT NULL DEFAULT '',
	amount_text TEXT NOT NULL DEFAULT '',
	amount_cents INTEGER,
	currency TEXT NOT NULL DEFAULT '',
	reference TEXT NOT NULL DEFAULT '',
	confidence REAL,
	diagnostics_json TEXT NOT NULL DEFAULT '[]',
	producer TEXT NOT NULL DEFAULT '',
	producer_version TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL,
	correction_json TEXT NOT NULL DEFAULT '',
	scanned_at TEXT NOT NULL DEFAULT '',
	PRIMARY KEY(user_id, id),
	UNIQUE(user_id, gmail_message_id)
)`

// emailReceiptInsertColumns lists the row columns with user_id last:
// the driver numbers every placeholder together, so the named user_id
// parameter stays last in every statement, matching store convention.
const emailReceiptInsertColumns = "id, gmail_message_id, thread_id, from_address, subject, message_date, verdict, merchant, receipt_date, amount_text, amount_cents, currency, reference, confidence, diagnostics_json, producer, producer_version, status, correction_json, scanned_at, user_id"

func (s *sqliteStore) ensureEmailReceipts() error {
	if _, err := s.db.Exec(emailReceiptsDDL); err != nil {
		return fmt.Errorf("ensure email receipts: %w", err)
	}
	return nil
}

func validateEmailReceiptInput(receipt store.EmailReceipt) error {
	if strings.TrimSpace(receipt.GmailMessageID) == "" {
		return fmt.Errorf("email receipt requires a Gmail message ID")
	}
	switch receipt.Verdict {
	case store.EmailReceiptVerdictReceipt, store.EmailReceiptVerdictRefund,
		store.EmailReceiptVerdictShipping, store.EmailReceiptVerdictOrdinary,
		store.EmailReceiptVerdictFailed:
	default:
		return fmt.Errorf("email receipt has an unknown verdict")
	}
	switch receipt.Status {
	case store.EmailReceiptStatusReady, store.EmailReceiptStatusNeedsReview, store.EmailReceiptStatusConfirmed:
	default:
		return fmt.Errorf("email receipt has an unknown status")
	}
	if len(receipt.Merchant) > 200 || len(receipt.Subject) > 300 || len(receipt.FromAddress) > 320 || len(receipt.Reference) > 200 {
		return fmt.Errorf("email receipt has an overlong merchant, subject, sender, or reference")
	}
	if receipt.ReceiptDate != "" {
		if _, err := time.Parse("2006-01-02", receipt.ReceiptDate); err != nil {
			return fmt.Errorf("email receipt date must be YYYY-MM-DD")
		}
	}
	if receipt.Currency != "" && (len(receipt.Currency) != 3 || strings.ToUpper(receipt.Currency) != receipt.Currency) {
		return fmt.Errorf("email receipt currency must be a 3-letter code")
	}
	if receipt.AmountCents != nil && (*receipt.AmountCents < 0 || *receipt.AmountCents > 1_000_000_000_000) {
		return fmt.Errorf("email receipt amounts must be nonnegative cents")
	}
	if receipt.Confidence != nil && (*receipt.Confidence < 0 || *receipt.Confidence > 1) {
		return fmt.Errorf("email receipt confidence must be between 0 and 1")
	}
	return nil
}

// SaveEmailReceipt records one triaged Gmail message. The Gmail message
// ID dedupes repeat scans: a repeat save keeps the first extraction and
// any user correction and returns the stored row, never a duplicate.
func (s *sqliteStore) SaveEmailReceipt(receipt store.EmailReceipt) (store.EmailReceipt, error) {
	if err := s.ensureEmailReceipts(); err != nil {
		return store.EmailReceipt{}, err
	}
	if err := validateEmailReceiptInput(receipt); err != nil {
		return store.EmailReceipt{}, err
	}
	id := strings.TrimSpace(receipt.ID)
	if id == "" {
		generated, err := newRowID()
		if err != nil {
			return store.EmailReceipt{}, err
		}
		id = generated
	}
	diagnostics, err := json.Marshal(receipt.Diagnostics)
	if err != nil {
		return store.EmailReceipt{}, fmt.Errorf("encode email receipt diagnostics: %w", err)
	}
	if string(diagnostics) == "null" {
		diagnostics = []byte("[]")
	}
	correction := ""
	if receipt.Correction != nil {
		encoded, err := json.Marshal(receipt.Correction)
		if err != nil {
			return store.EmailReceipt{}, fmt.Errorf("encode email receipt correction: %w", err)
		}
		correction = string(encoded)
	}
	scannedAt := strings.TrimSpace(receipt.ScannedAt)
	if scannedAt == "" {
		scannedAt = time.Now().UTC().Format(time.RFC3339)
	}
	_, err = s.db.Exec(`INSERT INTO email_receipts (`+emailReceiptInsertColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, gmail_message_id) DO NOTHING`,
		id, receipt.GmailMessageID, receipt.ThreadID, receipt.FromAddress, receipt.Subject,
		receipt.MessageDate, receipt.Verdict, receipt.Merchant, receipt.ReceiptDate,
		receipt.AmountText, receipt.AmountCents, receipt.Currency, receipt.Reference,
		receipt.Confidence, string(diagnostics), receipt.Provenance.Producer,
		receipt.Provenance.Version, receipt.Status, correction, scannedAt)
	if err != nil {
		return store.EmailReceipt{}, fmt.Errorf("save email receipt: %w", err)
	}
	var storedID string
	if err := s.db.QueryRow(`SELECT id FROM email_receipts WHERE gmail_message_id = ? AND user_id = :user_id`, receipt.GmailMessageID).Scan(&storedID); err != nil {
		return store.EmailReceipt{}, fmt.Errorf("read email receipt: %w", err)
	}
	return s.GetEmailReceipt(storedID)
}

// IsGmailMessageScanned reports whether a Gmail message already has a
// stored triage row, so repeat scans skip it without refetching.
func (s *sqliteStore) IsGmailMessageScanned(messageID string) (bool, error) {
	if err := s.ensureEmailReceipts(); err != nil {
		return false, err
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM email_receipts WHERE gmail_message_id = ? AND user_id = :user_id`, messageID).Scan(&count); err != nil {
		return false, fmt.Errorf("check scanned gmail message: %w", err)
	}
	return count > 0, nil
}

func scanEmailReceipt(rows *sql.Rows) (store.EmailReceipt, error) {
	var receipt store.EmailReceipt
	var amountCents sql.NullInt64
	var confidence sql.NullFloat64
	var diagnosticsJSON, correctionJSON string
	if err := rows.Scan(&receipt.ID, &receipt.GmailMessageID, &receipt.ThreadID,
		&receipt.FromAddress, &receipt.Subject, &receipt.MessageDate, &receipt.Verdict,
		&receipt.Merchant, &receipt.ReceiptDate, &receipt.AmountText, &amountCents,
		&receipt.Currency, &receipt.Reference, &confidence, &diagnosticsJSON,
		&receipt.Provenance.Producer, &receipt.Provenance.Version, &receipt.Status,
		&correctionJSON, &receipt.ScannedAt); err != nil {
		return store.EmailReceipt{}, err
	}
	if amountCents.Valid {
		receipt.AmountCents = &amountCents.Int64
	}
	if confidence.Valid {
		receipt.Confidence = &confidence.Float64
	}
	if diagnosticsJSON != "" {
		if err := json.Unmarshal([]byte(diagnosticsJSON), &receipt.Diagnostics); err != nil {
			return store.EmailReceipt{}, fmt.Errorf("decode email receipt diagnostics: %w", err)
		}
	}
	if correctionJSON != "" {
		var correction store.EmailReceiptCorrection
		if err := json.Unmarshal([]byte(correctionJSON), &correction); err != nil {
			return store.EmailReceipt{}, fmt.Errorf("decode email receipt correction: %w", err)
		}
		receipt.Correction = &correction
	}
	return receipt, nil
}

// ListEmailReceipts returns stored email receipts in ID order, filtered
// by verdict and status with cursor pagination.
func (s *sqliteStore) ListEmailReceipts(filter store.EmailReceiptFilter) ([]store.EmailReceipt, error) {
	if err := s.ensureEmailReceipts(); err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	query := `SELECT id, gmail_message_id, thread_id, from_address, subject, message_date, verdict, merchant, receipt_date, amount_text, amount_cents, currency, reference, confidence, diagnostics_json, producer, producer_version, status, correction_json, scanned_at FROM email_receipts WHERE id > ?`
	args := []any{filter.Cursor}
	if len(filter.Verdict) > 0 {
		query += ` AND verdict IN (` + strings.TrimSuffix(strings.Repeat("?,", len(filter.Verdict)), ",") + `)`
		for _, verdict := range filter.Verdict {
			args = append(args, verdict)
		}
	}
	if len(filter.Status) > 0 {
		query += ` AND status IN (` + strings.TrimSuffix(strings.Repeat("?,", len(filter.Status)), ",") + `)`
		for _, status := range filter.Status {
			args = append(args, status)
		}
	}
	// The named user_id parameter stays last and the limit is literal:
	// the driver numbers every placeholder together.
	query += ` AND user_id = :user_id ORDER BY id LIMIT ` + strconv.Itoa(limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list email receipts: %w", err)
	}
	defer rows.Close()
	result := []store.EmailReceipt{}
	for rows.Next() {
		receipt, err := scanEmailReceipt(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, receipt)
	}
	return result, rows.Err()
}

// GetEmailReceipt reads one stored email receipt by ID.
func (s *sqliteStore) GetEmailReceipt(id string) (store.EmailReceipt, error) {
	if err := s.ensureEmailReceipts(); err != nil {
		return store.EmailReceipt{}, err
	}
	rows, err := s.db.Query(`SELECT id, gmail_message_id, thread_id, from_address, subject, message_date, verdict, merchant, receipt_date, amount_text, amount_cents, currency, reference, confidence, diagnostics_json, producer, producer_version, status, correction_json, scanned_at FROM email_receipts WHERE id = ? AND user_id = :user_id`, id)
	if err != nil {
		return store.EmailReceipt{}, fmt.Errorf("read email receipt: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return store.EmailReceipt{}, store.ErrNotFound
	}
	receipt, err := scanEmailReceipt(rows)
	if err != nil {
		return store.EmailReceipt{}, err
	}
	return receipt, rows.Err()
}

// ReviewEmailReceipt confirms or corrects one extraction. The correction
// overlays the original values and marks the row confirmed; a nil
// correction confirms the extraction as-is. The original extraction and
// provenance are preserved.
func (s *sqliteStore) ReviewEmailReceipt(id string, correction *store.EmailReceiptCorrection) (store.EmailReceipt, error) {
	if err := s.ensureEmailReceipts(); err != nil {
		return store.EmailReceipt{}, err
	}
	if correction != nil {
		if len(correction.Merchant) > 200 || len(correction.Reference) > 200 {
			return store.EmailReceipt{}, fmt.Errorf("email receipt correction has an overlong merchant or reference")
		}
		if correction.ReceiptDate != "" {
			if _, err := time.Parse("2006-01-02", correction.ReceiptDate); err != nil {
				return store.EmailReceipt{}, fmt.Errorf("email receipt correction date must be YYYY-MM-DD")
			}
		}
		if correction.Currency != "" && (len(correction.Currency) != 3 || strings.ToUpper(correction.Currency) != correction.Currency) {
			return store.EmailReceipt{}, fmt.Errorf("email receipt correction currency must be a 3-letter code")
		}
		if correction.AmountCents != nil && (*correction.AmountCents < 0 || *correction.AmountCents > 1_000_000_000_000) {
			return store.EmailReceipt{}, fmt.Errorf("email receipt correction amounts must be nonnegative cents")
		}
	}
	encoded := ""
	if correction != nil {
		raw, err := json.Marshal(correction)
		if err != nil {
			return store.EmailReceipt{}, fmt.Errorf("encode email receipt correction: %w", err)
		}
		encoded = string(raw)
	}
	result, err := s.db.Exec(`UPDATE email_receipts SET correction_json = ?, status = ? WHERE id = ? AND user_id = :user_id`, encoded, store.EmailReceiptStatusConfirmed, id)
	if err != nil {
		return store.EmailReceipt{}, fmt.Errorf("review email receipt: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return store.EmailReceipt{}, fmt.Errorf("review email receipt: %w", err)
	}
	if affected == 0 {
		return store.EmailReceipt{}, store.ErrNotFound
	}
	return s.GetEmailReceipt(id)
}
