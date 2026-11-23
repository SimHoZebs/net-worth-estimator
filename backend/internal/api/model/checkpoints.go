package model

import (
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// checkpointKey identifies one observation: the account and exact instant.
// Several observations per day survive; an owner row wins only at its own
// instant.
func checkpointKey(checkpoint types.Checkpoint) string {
	return checkpoint.AccountID + "\x00" + strconv.FormatInt(checkpoint.ObservedAt, 10)
}
