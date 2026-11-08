// Package evaluations exposes evaluation-reader execution status.
// The read is passive: it derives state from the existing projection
// manifest (revision / published / dirty) and never starts work.
package evaluations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

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
	sum := sha256.Sum256([]byte(state.DetEvaluationsJSON))
	fingerprint := fmt.Sprintf("%d:%s", state.Revision, hex.EncodeToString(sum[:8]))
	status := evaluationStatus{
		State:               "idle",
		CurrentRevision:     state.Revision,
		PublishedRevision:   state.PublishedRevision,
		DirtyFrom:           state.DirtyFrom,
		Fingerprint:         fingerprint,
		ProjectionAvailable: state.PublishedRevision > 0 && state.DirtyFrom == 0,
	}
	if state.DirtyFrom != 0 {
		status.State = "queued"
	} else if state.PublishedRevision == state.Revision && state.Revision > 0 {
		status.State = "succeeded"
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
