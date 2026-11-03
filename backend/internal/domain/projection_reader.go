package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// FindFirstInvalidSlice returns the index of the first slice with ToAt
// after dirtyFrom. It returns -1 when no slice is invalid. Empty
// dirtyFrom means no rebuild is needed.
func FindFirstInvalidSlice(slices []types.ProjectionSlice, dirtyFrom int64) int {
	if dirtyFrom <= 0 {
		return -1
	}
	for i, sl := range slices {
		if sl.ToAt >= dirtyFrom {
			return i
		}
	}
	return -1
}
