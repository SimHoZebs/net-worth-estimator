package analyses

import (
	"context"
	"errors"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type analysisStatus struct {
	Type            string             `json:"type"`
	Version         string             `json:"version"`
	State           string             `json:"state"`
	CurrentRevision int64              `json:"currentRevision"`
	Run             *types.AnalysisRun `json:"run,omitempty"`
}

type handler struct {
	store    store.AnalysisStore
	canWrite func(context.Context) bool
	actor    func(context.Context) string
}

// Register adds passive Analysis reads and explicit review operations.
func Register(api huma.API, st store.AnalysisStore, canWrite func(context.Context) bool, actor func(context.Context) string) {
	s := &handler{store: st, canWrite: canWrite, actor: actor}
	huma.Register(api, huma.Operation{OperationID: "list-analyses", Method: "GET", Path: "/v1/analyses", Summary: "Read background analysis status without starting work"}, s.listAnalyses)
	huma.Register(api, huma.Operation{OperationID: "list-analysis-findings", Method: "GET", Path: "/v1/analysis-findings", Summary: "Read persisted transaction findings"}, s.listAnalysisFindings)
	huma.Register(api, huma.Operation{OperationID: "dismiss-analysis-finding", Method: "PATCH", Path: "/v1/analysis-findings/{id}", Summary: "Dismiss or restore a transaction finding"}, s.dismissAnalysisFinding)
	huma.Register(api, huma.Operation{OperationID: "review-analysis-finding", Method: "POST", Path: "/v1/analysis-findings/{id}/feedback", Summary: "Confirm or reject a finding and record plan duration"}, s.reviewAnalysisFinding)
	huma.Register(api, huma.Operation{OperationID: "list-analysis-feedback", Method: "GET", Path: "/v1/analysis-feedback", Summary: "Read private labeled feedback with prediction provenance"}, s.listAnalysisFeedback)
}

func (s *handler) listAnalyses(_ context.Context, _ *struct{}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Analyses []analysisStatus `json:"analyses"`
	}
}, error) {
	runs, revision, err := s.store.ListAnalysisRuns()
	if err != nil {
		return nil, huma.Error500InternalServerError("Analysis status is temporarily unavailable")
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Analyses []analysisStatus `json:"analyses"`
		}
	}{CacheControl: "private, no-store"}
	output.Body.Analyses = []analysisStatus{}
	for _, definition := range analysis.Definitions() {
		status := analysisStatus{Type: definition.Type(), Version: definition.Version(), State: "idle", CurrentRevision: revision}
		if revision > 0 {
			status.State = "queued"
		}
		for _, run := range runs {
			if run.Type != status.Type {
				continue
			}
			status.Run, status.State = &run, run.State
			if run.InputRevision != revision || run.Version != status.Version || run.State == "superseded" {
				status.State = "queued"
			}
		}
		output.Body.Analyses = append(output.Body.Analyses, status)
	}
	return output, nil
}

type listAnalysisFindingsInput struct {
	PostingIDs string `query:"postingIds" maxLength:"7500" doc:"Comma-separated saved transaction UUIDs, at most 200"`
	Cursor     string `query:"cursor" maxLength:"100"`
	Limit      int    `query:"limit" default:"50" minimum:"1" maximum:"100"`
}

type analysisFindingsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Findings   []types.AnalysisFinding `json:"findings"`
		NextCursor string                  `json:"nextCursor"`
	}
}

func (s *handler) listAnalysisFindings(_ context.Context, input *listAnalysisFindingsInput) (*analysisFindingsOutput, error) {
	filter := types.AnalysisFindingFilter{Cursor: input.Cursor, Limit: input.Limit + 1}
	if input.PostingIDs != "" {
		filter.PostingIDs = strings.Split(input.PostingIDs, ",")
		if len(filter.PostingIDs) > 200 {
			return nil, huma.Error422UnprocessableEntity("At most 200 transaction IDs are allowed")
		}
	}
	items, err := s.store.ListAnalysisFindings(filter)
	if err != nil {
		return nil, huma.Error500InternalServerError("Analysis findings are temporarily unavailable")
	}
	output := &analysisFindingsOutput{CacheControl: "private, no-store"}
	if len(items) > input.Limit {
		items = items[:input.Limit]
		output.Body.NextCursor = items[len(items)-1].ID
	}
	for _, definition := range analysis.Definitions() {
		for i := range items {
			if items[i].Status == "active" && items[i].AnalysisType == definition.Type() && items[i].AnalyzerVersion != definition.Version() {
				items[i].Stale = true
			}
		}
	}
	output.Body.Findings = items
	return output, nil
}

func (s *handler) dismissAnalysisFinding(ctx context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		Dismissed bool `json:"dismissed"`
	}
}) (*struct {
	Body struct {
		ID        string `json:"id"`
		Dismissed bool   `json:"dismissed"`
	}
}, error) {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	actor := ""
	if s.actor != nil {
		actor = s.actor(ctx)
	}
	if err := s.store.DismissAnalysisFinding(input.ID, input.Body.Dismissed, actor); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, huma.Error404NotFound("Finding not found")
		}
		return nil, huma.Error500InternalServerError("Finding review is temporarily unavailable")
	}
	output := &struct {
		Body struct {
			ID        string `json:"id"`
			Dismissed bool   `json:"dismissed"`
		}
	}{}
	output.Body.ID, output.Body.Dismissed = input.ID, input.Body.Dismissed
	return output, nil
}
