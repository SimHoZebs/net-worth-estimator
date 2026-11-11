package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// incrementalTriggerDDLs owns the trigger definitions that also maintain the
// dirty set. Fresh databases get them from analysisSchemaStatements;
// pre-existing databases gain them through ensureIncrementalSchema, which
// drops outdated triggers whose body lacks the dirty maintenance.
func incrementalTriggerDDLs() map[string]string {
	return map[string]string{
		"analysis_facts_insert": `CREATE TRIGGER analysis_facts_insert AFTER INSERT ON transaction_source_facts BEGIN
			INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
			ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO analysis_fact_dirty(user_id, transaction_id, revision, kind)
			VALUES (NEW.user_id, NEW.transaction_id, (SELECT revision FROM analysis_inputs WHERE user_id = NEW.user_id), 'added')
			ON CONFLICT(user_id, transaction_id) DO UPDATE SET revision = excluded.revision, kind = excluded.kind;
		END`,
		"analysis_facts_update": `CREATE TRIGGER analysis_facts_update AFTER UPDATE ON transaction_source_facts BEGIN
			INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
			ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO analysis_fact_dirty(user_id, transaction_id, revision, kind)
			VALUES (NEW.user_id, NEW.transaction_id, (SELECT revision FROM analysis_inputs WHERE user_id = NEW.user_id),
				CASE WHEN IFNULL(json_extract(OLD.facts_json, '$.amount'), '') != IFNULL(json_extract(NEW.facts_json, '$.amount'), '') THEN 'amount-corrected' ELSE 'facts-changed' END)
			ON CONFLICT(user_id, transaction_id) DO UPDATE SET revision = excluded.revision, kind = excluded.kind;
		END`,
		"analysis_facts_delete": `CREATE TRIGGER analysis_facts_delete AFTER DELETE ON transaction_source_facts BEGIN
			INSERT INTO analysis_inputs(user_id, revision) VALUES (OLD.user_id, 1)
			ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO analysis_fact_dirty(user_id, transaction_id, revision, kind)
			VALUES (OLD.user_id, OLD.transaction_id, (SELECT revision FROM analysis_inputs WHERE user_id = OLD.user_id), 'deleted')
			ON CONFLICT(user_id, transaction_id) DO UPDATE SET revision = excluded.revision, kind = excluded.kind;
		END`,
		"analysis_transaction_lifecycle": `CREATE TRIGGER analysis_transaction_lifecycle AFTER UPDATE OF pending, void ON transactions
		WHEN (OLD.pending != NEW.pending OR OLD.void != NEW.void)
		AND EXISTS(SELECT 1 FROM transaction_source_facts WHERE user_id = NEW.user_id AND transaction_id = NEW.id)
		BEGIN INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
		INSERT INTO analysis_fact_dirty(user_id, transaction_id, revision, kind)
		VALUES (NEW.user_id, NEW.id, (SELECT revision FROM analysis_inputs WHERE user_id = NEW.user_id),
			CASE WHEN OLD.void != NEW.void THEN 'void-flipped' ELSE 'pending-flipped' END)
		ON CONFLICT(user_id, transaction_id) DO UPDATE SET revision = excluded.revision, kind = excluded.kind; END`,
	}
}

// ensureIncrementalSchema creates the additive incremental tables and refreshes
// outdated triggers. Tables are CREATE IF NOT EXISTS so fresh and existing
// databases converge; triggers are dropped and recreated only when their body
// lacks dirty maintenance, so steady-state calls are read-only checks.
func ensureIncrementalSchemaDB(db *sql.DB) error {
	for _, ddl := range []string{analysisFactDirtyDDL, analysisPaymentStreamsDDL} {
		if _, err := db.Exec(ddl); err != nil {
			return fmt.Errorf("ensure incremental tables: %w", err)
		}
	}
	want := incrementalTriggerDDLs()
	names := make([]string, 0, len(want))
	for name := range want {
		names = append(names, "'"+name+"'")
	}
	rows, err := db.Query(`SELECT name, COALESCE(sql, '') FROM sqlite_master WHERE type = 'trigger' AND name IN (` + strings.Join(names, ",") + `)`)
	if err != nil {
		return fmt.Errorf("read incremental triggers: %w", err)
	}
	have := map[string]string{}
	for rows.Next() {
		var name, body string
		if err := rows.Scan(&name, &body); err != nil {
			rows.Close()
			return err
		}
		have[name] = body
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for name, ddl := range want {
		body, ok := have[name]
		if ok && strings.Contains(body, "analysis_fact_dirty") {
			continue
		}
		if _, err := db.Exec(`DROP TRIGGER IF EXISTS ` + name); err != nil {
			return fmt.Errorf("drop outdated trigger %s: %w", name, err)
		}
		if _, err := db.Exec(ddl); err != nil {
			return fmt.Errorf("refresh trigger %s: %w", name, err)
		}
	}
	return nil
}

func (s *sqliteStore) ensureIncrementalSchema() error {
	return ensureIncrementalSchemaDB(s.db.DB)
}

// refreshIncrementalTriggersTx refreshes outdated incremental triggers inside
// the setup transaction for existing databases. Tables are created by the
// caller; this only drops and recreates trigger bodies lacking dirty logic.
func refreshIncrementalTriggersTx(tx *sql.Tx) error {
	want := incrementalTriggerDDLs()
	names := make([]string, 0, len(want))
	for name := range want {
		names = append(names, "'"+name+"'")
	}
	rows, err := tx.Query(`SELECT name, COALESCE(sql, '') FROM sqlite_master WHERE type = 'trigger' AND name IN (` + strings.Join(names, ",") + `)`)
	if err != nil {
		return fmt.Errorf("read incremental triggers: %w", err)
	}
	have := map[string]string{}
	for rows.Next() {
		var name, body string
		if err := rows.Scan(&name, &body); err != nil {
			rows.Close()
			return err
		}
		have[name] = body
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for name, ddl := range want {
		body, ok := have[name]
		if ok && strings.Contains(body, "analysis_fact_dirty") {
			continue
		}
		if _, err := tx.Exec(`DROP TRIGGER IF EXISTS ` + name); err != nil {
			return fmt.Errorf("drop outdated trigger %s: %w", name, err)
		}
		if _, err := tx.Exec(ddl); err != nil {
			return fmt.Errorf("refresh trigger %s: %w", name, err)
		}
	}
	return nil
}

// ListAnalysisDirtyFacts reports durable dirty facts after sinceRevision.
func (s *sqliteStore) ListAnalysisDirtyFacts(sinceRevision int64) ([]store.AnalysisDirtyFact, error) {
	if err := s.ensureIncrementalSchema(); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT transaction_id, revision, kind FROM analysis_fact_dirty WHERE revision > ? AND user_id = :user_id ORDER BY revision, transaction_id`, sinceRevision)
	if err != nil {
		return nil, fmt.Errorf("list dirty facts: %w", err)
	}
	defer rows.Close()
	out := []store.AnalysisDirtyFact{}
	for rows.Next() {
		var item store.AnalysisDirtyFact
		if err := rows.Scan(&item.TransactionID, &item.Revision, &item.Kind); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// ListAnalysisPaymentStreams returns every cached payment stream.
func (s *sqliteStore) ListAnalysisPaymentStreams() ([]store.AnalysisPaymentStream, error) {
	if err := s.ensureIncrementalSchema(); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT stream_id, stats_json, member_ids_json, consumed_revision, identity_version FROM analysis_payment_streams WHERE user_id = :user_id ORDER BY stream_id`)
	if err != nil {
		return nil, fmt.Errorf("list payment streams: %w", err)
	}
	defer rows.Close()
	out := []store.AnalysisPaymentStream{}
	for rows.Next() {
		var item store.AnalysisPaymentStream
		var members string
		if err := rows.Scan(&item.StreamID, &item.StatsJSON, &members, &item.ConsumedRevision, &item.IdentityVersion); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(members), &item.MemberTransactionIDs); err != nil {
			return nil, fmt.Errorf("decode stream members %s: %w", item.StreamID, err)
		}
		if item.MemberTransactionIDs == nil {
			item.MemberTransactionIDs = []string{}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// GetAnalysisPaymentStream reads one cached payment stream.
func (s *sqliteStore) GetAnalysisPaymentStream(streamID string) (store.AnalysisPaymentStream, error) {
	var out store.AnalysisPaymentStream
	if streamID == "" {
		return out, store.NotFound("")
	}
	if err := s.ensureIncrementalSchema(); err != nil {
		return out, err
	}
	var members string
	err := s.db.QueryRow(`SELECT stream_id, stats_json, member_ids_json, consumed_revision, identity_version FROM analysis_payment_streams WHERE stream_id = ? AND user_id = :user_id`, streamID).Scan(&out.StreamID, &out.StatsJSON, &members, &out.ConsumedRevision, &out.IdentityVersion)
	if err == sql.ErrNoRows {
		return out, store.NotFound(streamID)
	}
	if err != nil {
		return out, fmt.Errorf("read payment stream %s: %w", streamID, err)
	}
	if err := json.Unmarshal([]byte(members), &out.MemberTransactionIDs); err != nil {
		return out, fmt.Errorf("decode stream members %s: %w", streamID, err)
	}
	if out.MemberTransactionIDs == nil {
		out.MemberTransactionIDs = []string{}
	}
	return out, nil
}

// SaveAnalysisPaymentStream upserts one cached payment stream.
func (s *sqliteStore) SaveAnalysisPaymentStream(stream store.AnalysisPaymentStream) error {
	if stream.StreamID == "" {
		return fmt.Errorf("payment stream requires an ID")
	}
	if err := s.ensureIncrementalSchema(); err != nil {
		return err
	}
	members, err := json.Marshal(stream.MemberTransactionIDs)
	if err != nil {
		return fmt.Errorf("encode stream members %s: %w", stream.StreamID, err)
	}
	stats := stream.StatsJSON
	if stats == "" {
		stats = "{}"
	}
	if !json.Valid([]byte(stats)) {
		return fmt.Errorf("payment stream %s carries invalid stats JSON", stream.StreamID)
	}
	if _, err := s.db.Exec(`INSERT INTO analysis_payment_streams(stream_id, stats_json, member_ids_json, consumed_revision, identity_version, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)
		ON CONFLICT(user_id, stream_id) DO UPDATE SET stats_json = excluded.stats_json, member_ids_json = excluded.member_ids_json,
			consumed_revision = excluded.consumed_revision, identity_version = excluded.identity_version`,
		stream.StreamID, stats, string(members), stream.ConsumedRevision, stream.IdentityVersion); err != nil {
		return fmt.Errorf("save payment stream %s: %w", stream.StreamID, err)
	}
	return nil
}

// DeleteAnalysisPaymentStream removes one cached payment stream.
func (s *sqliteStore) DeleteAnalysisPaymentStream(streamID string) error {
	if streamID == "" {
		return fmt.Errorf("payment stream requires an ID")
	}
	if err := s.ensureIncrementalSchema(); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM analysis_payment_streams WHERE stream_id = ? AND user_id = :user_id`, streamID); err != nil {
		return fmt.Errorf("delete payment stream %s: %w", streamID, err)
	}
	return nil
}
