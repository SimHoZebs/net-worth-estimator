package types

// EvaluationRun tracks one asynchronous evaluation-reader execution.
// It mirrors AnalysisRun semantics: lease-based claim, revision-gated publish.
type EvaluationRun struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Version       string `json:"version"`
	InputRevision int64  `json:"inputRevision"`
	Fingerprint   string `json:"fingerprint"`
	State         string `json:"state"`
	StartedAt     int64  `json:"startedAt"`
	CompletedAt   int64  `json:"completedAt"`
	Problem       string `json:"problem"`
}

// EvaluationSnapshot is the worker input claim view.
// Revision + Fingerprint derive from projection_states.revision and
// det_evaluations_json; both track when model/evaluation config changed.
type EvaluationSnapshot struct {
	Revision           int64
	Fingerprint        string
	DetEvaluationsJSON string
}
