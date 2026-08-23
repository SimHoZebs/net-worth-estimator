package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// Shared aliases for evaluator signatures.
type IsoDate = types.IsoDate

// EvaluationRegistryInstance is the process-wide definition registry.
var EvaluationRegistryInstance = evaluationRegistryInstance
