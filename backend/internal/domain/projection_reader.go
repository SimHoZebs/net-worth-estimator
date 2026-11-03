package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// FindFirstInvalidSlice returns the index of the first slice with ToAt
// after dirtyFrom. It returns -1 when no slice is invalid. Empty
// dirtyFrom means no rebuild is needed.
func FindFirstInvalidSlice(slices []types.ProjectionSlice, dirtyFrom string) int {
	if dirtyFrom == "" {
		return -1
	}
	for i, sl := range slices {
		if sl.ToAt >= dirtyFrom {
			return i
		}
	}
	return -1
}

// SlicesNeedRebuild reports whether any suffix rebuild is needed for the
// given state revision. Slices built at the current revision and at or
// after dirtyFrom stay valid only when dirtyFrom is empty.
func SlicesNeedRebuild(slices []types.ProjectionSlice, state types.ProjectionState) bool {
	if state.DirtyFrom == "" {
		for _, sl := range slices {
			if sl.BuiltRevision != state.Revision {
				return true
			}
		}
		return false
	}
	return FindFirstInvalidSlice(slices, state.DirtyFrom) != -1
}
