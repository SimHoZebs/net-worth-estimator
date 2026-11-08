// Package evaluations exposes evaluation-reader execution status.
// The read is passive: it never starts work.
package evaluations

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type handler struct {
	store store.Store
}

type evaluationStatus struct {
	State               string `json:"state"`
	CurrentRevision     int64  `json:"currentRevision"`
	PublishedRevision   int64  `json:"publishedRevision"`
	DirtyFrom           int64  `json:"dirtyFrom"`
	Fingerprint         string `json:"fingerprint"`
	ProjectionAvailable bool   `json:"projectionAvailable"`
}

// Register adds the passive evaluations status read.
func Register(api huma.API, st store.Store) {
	s := &handler{store: st}
	huma.Register(api, huma.Operation{OperationID: "list-evaluations-status", Method: "GET", Path: "/v1/evaluations/status", Summary: "Read evaluation reader execution status without starting work"}, s.listStatus)
}

func (s *handler) listStatus(_ context.Context, _ *struct{}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Status evaluationStatus `json:"status"`
	}
}, error) {
	state, err := s.store.GetProjectionState()
	if err != nil {
		return nil, huma.Error500InternalServerError("Evaluation status is temporarily unavailable")
	}
	runs, revision, fingerprint, err := s.store.ListEvaluationWorkerRuns()
	if err != nil {
		return nil, huma.Error500InternalServerError("Evaluation status is temporarily unavailable")
	}
	status := evaluationStatus{
		State:               "idle",
		CurrentRevision:     revision,
		PublishedRevision:   state.PublishedRevision,
		DirtyFrom:           state.DirtyFrom,
		Fingerprint:         fingerprint,
		ProjectionAvailable: state.PublishedRevision > 0 && state.DirtyFrom == 0,
	}
	if len(runs) > 0 {
		latest := runs[0]
		if latest.State == "running" {
			status.State = "running"
		} else if latest.State == "failed" {
			status.State = "failed"
		} else if latest.Fingerprint != fingerprint {
			status.State = "queued"
		} else {
			status.State = "succeeded"
		}
		if latest.State == "running" {
			status.State = "running"
		}
	}
	if len(runs) == 0 && fingerprint != "" {
		// No run yet for this fingerprint but model exists → queued.
		// Idle only when no model/projection has ever been initialized.
		if status.CurrentRevision > 0 || state.ProjectionStart != "" {
			status.State = "queued"
		}
	}

	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Status evaluationStatus `json:"status"`
		}
	}{CacheControl: "private, no-store"}
	output.Body.Status = status
	return output, nil
}
