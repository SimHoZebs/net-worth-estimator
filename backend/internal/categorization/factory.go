package categorization

import (
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
)

// NewClassifierFromEnv composes the classifier from the environment. The
// keyword classifier runs first and the learner backfills only what keywords
// skip, so the model may add labels but never replaces a keyword answer.
// A blank ML_JUDGMENT_URL or ML_CATEGORIES=0 forces keyword-only: the
// former means no model endpoint is configured, the latter is the operator
// kill switch for taking the model out of the path entirely.
//
// Mains must use this factory instead of importing judgment directly. The
// factory owns the judgment import; mains stay decoupled from the
// model-serving transport.
func NewClassifierFromEnv(getenv func(string) string) Classifier {
	endpoint := strings.TrimSpace(getenv("ML_JUDGMENT_URL"))
	if endpoint == "" || strings.TrimSpace(getenv("ML_CATEGORIES")) == "0" {
		return KeywordClassifier{}
	}
	return CompositeClassifier{
		ML:      NewMLClassifier(judgment.NewHTTPProvider(endpoint, 5*time.Second)),
		Keyword: KeywordClassifier{},
	}
}
