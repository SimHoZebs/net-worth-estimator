package sqlite

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *sqliteStore) ReviewAnalysisFinding(id string, input types.AnalysisFeedbackInput) (types.AnalysisFeedback, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return types.AnalysisFeedback{}, err
	}
	defer tx.Rollback()
	feedback, err := applyAnalysisFeedback(tx, id, input, true)
	if err != nil {
		return types.AnalysisFeedback{}, err
	}
	return feedback, tx.Commit()
}

// Hide/restore is a presentation action. It is logged, but never
// becomes a positive/negative training label merely because a flag was hidden.
func (s *sqliteStore) DismissAnalysisFinding(id string, dismissed bool, actor string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	requestID, err := newRowID()
	if err != nil {
		return err
	}
	action := "restore"
	if dismissed {
		action = "hide"
	}
	if _, err := applyAnalysisFeedback(tx, id, types.AnalysisFeedbackInput{RequestID: requestID, Action: action, Actor: actor}, false); err != nil {
		return err
	}
	return tx.Commit()
}

func validFeedback(input types.AnalysisFeedbackInput) bool {
	id, err := uuid.Parse(input.RequestID)
	if err != nil || id.String() != input.RequestID || input.Revision < 0 {
		return false
	}
	switch input.Action {
	case "confirm", "reject", "hide", "restore":
		return input.Duration == nil
	case "set-duration":
		return input.Duration != nil && input.Duration.Count >= 1 && input.Duration.Count <= 5200 && (input.Duration.Unit == "weeks" || input.Duration.Unit == "months")
	default:
		return false
	}
}

func applyAnalysisFeedback(tx *userTx, id string, input types.AnalysisFeedbackInput, strict bool) (types.AnalysisFeedback, error) {
	var feedback types.AnalysisFeedback
	if !validFeedback(input) {
		return feedback, store.ErrAnalysisFeedbackInvalid
	}
	actor := input.Actor
	if actor == "" {
		actor = tx.userID
	}
	input.Actor = "" // The immutable event carries the verified actor separately.
	var replayJSON string
	err := tx.QueryRow(`SELECT payload_json FROM analysis_feedback WHERE request_id = ? AND user_id = :user_id`, input.RequestID).Scan(&replayJSON)
	if err == nil {
		if err := json.Unmarshal([]byte(replayJSON), &feedback); err != nil {
			return feedback, err
		}
		if feedback.FindingID != id || feedback.Actor != actor || !reflect.DeepEqual(feedback.Request, input) {
			return types.AnalysisFeedback{}, store.ErrAnalysisFeedbackConflict
		}
		return feedback, nil
	}
	if err != sql.ErrNoRows {
		return feedback, err
	}
	var predictionJSON, reviewJSON, status string
	var pending, void bool
	var previousRevision int64
	var dismissed bool
	err = tx.QueryRow(`SELECT f.detection_json, f.run_id, f.review_json, f.feedback_revision, f.dismissed, f.status,
		r.type, r.version, r.input_revision, p.pending, p.void FROM analysis_findings f
		JOIN analysis_runs r ON r.user_id = f.user_id AND r.id = f.run_id
		JOIN postings p ON p.user_id = f.user_id AND p.id = f.posting_id
		WHERE f.id = ? AND f.user_id = :user_id`, id).Scan(&predictionJSON, &feedback.RunID, &reviewJSON, &previousRevision, &dismissed, &status,
		&feedback.AnalysisType, &feedback.AnalyzerVersion, &feedback.InputRevision, &pending, &void)
	if err == sql.ErrNoRows {
		return feedback, store.ErrNotFound
	}
	if err != nil {
		return feedback, err
	}
	if strict && (input.RunID != feedback.RunID || input.Revision != previousRevision) {
		return feedback, store.ErrAnalysisFeedbackConflict
	}
	if !strict {
		input.RunID, input.Revision = feedback.RunID, previousRevision
	}
	if err := json.Unmarshal([]byte(predictionJSON), &feedback.Prediction); err != nil {
		return feedback, err
	}
	if err := json.Unmarshal([]byte(reviewJSON), &feedback.Review); err != nil {
		return feedback, err
	}
	if input.Action == "confirm" || input.Action == "reject" || input.Action == "set-duration" {
		if pending || void || feedback.Prediction.Kind != "bnpl" {
			return feedback, store.ErrAnalysisFeedbackInvalid
		}
	}
	if input.Action == "confirm" || input.Action == "reject" {
		// Withdrawal retains the original run ID for provenance. An unanswered
		// prompt must not label a prediction that no longer applies.
		if feedback.Review == nil && status != "active" {
			return feedback, store.ErrAnalysisFeedbackConflict
		}
		revision, err := analysisRevision(tx)
		if err != nil {
			return feedback, err
		}
		if revision != feedback.InputRevision {
			return feedback, store.ErrAnalysisFeedbackConflict
		}
	}
	now := time.Now().Unix()
	provider := feedback.Prediction.Provider
	if feedback.Review != nil {
		provider = feedback.Review.Provider
	}
	switch input.Action {
	case "confirm":
		if feedback.Review == nil || feedback.Review.Decision != "confirmed" {
			feedback.Review = &types.AnalysisReview{Decision: "confirmed", Provider: provider, AnsweredAt: now}
		}
		dismissed = false
	case "reject":
		feedback.Review = &types.AnalysisReview{Decision: "rejected", Provider: provider, AnsweredAt: now}
		dismissed = true
	case "set-duration":
		if feedback.Review == nil || feedback.Review.Decision != "confirmed" {
			return feedback, store.ErrAnalysisFeedbackInvalid
		}
		feedback.Review.Duration, dismissed = input.Duration, false
	case "hide":
		dismissed = true
	case "restore":
		dismissed = false
		if feedback.Review != nil && feedback.Review.Decision == "rejected" {
			feedback.Review = nil
		}
	}
	feedback.ID, err = newRowID()
	if err != nil {
		return feedback, err
	}
	feedback.FindingID, feedback.PostingID = id, feedback.Prediction.PostingID
	feedback.Actor, feedback.Request, feedback.CreatedAt = actor, input, now
	feedback.Revision, feedback.Dismissed = previousRevision+1, dismissed
	currentReviewJSON, err := json.Marshal(feedback.Review)
	if err != nil {
		return feedback, err
	}
	data, err := json.Marshal(feedback)
	if err != nil {
		return feedback, err
	}
	if _, err := tx.Exec(`INSERT INTO analysis_feedback(id, request_id, finding_id, run_id, created_at, payload_json, user_id) VALUES (?, ?, ?, ?, ?, ?, :user_id)`, feedback.ID, input.RequestID, id, feedback.RunID, now, string(data)); err != nil {
		return feedback, err
	}
	if _, err := tx.Exec(`UPDATE analysis_findings SET review_json = ?, feedback_revision = ?, dismissed = ? WHERE id = ? AND user_id = :user_id`, string(currentReviewJSON), feedback.Revision, boolToInt(dismissed), id); err != nil {
		return feedback, err
	}
	return feedback, nil
}
