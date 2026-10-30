// Package modelstate owns the model revision and storage-error HTTP contracts
// shared by canonical model writes and SimpleFIN account links.
package modelstate

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// WriteError maps storage failures to the existing model-write HTTP errors.
func WriteError(err error) error {
	switch {
	case store.IsNotFound(err):
		return huma.Error404NotFound("row not found")
	case store.IsIDConflict(err):
		return huma.Error409Conflict("id already exists")
	case store.IsInvalidID(err):
		return huma.Error422UnprocessableEntity("row id must be a canonical UUID")
	case store.IsSyncOwned(err):
		return huma.Error422UnprocessableEntity("sync-owned rows are read-only")
	case store.IsAccountMissing(err):
		return huma.Error422UnprocessableEntity("referenced account does not exist")
	default:
		return huma.Error500InternalServerError(err.Error())
	}
}

// CurrentRevision identifies the current stored model, including an empty one.
func CurrentRevision(st store.Store) (string, error) {
	model, err := st.LoadModel()
	if err != nil {
		return "", err
	}
	return store.ModelETag(model)
}

// ReorderOutput carries the model revision after a reorder or deletion.
// Keep its name stable because it identifies an existing OpenAPI component.
type ReorderOutput struct {
	Body struct {
		Revision string `json:"revision"`
	} `json:"body"`
}
