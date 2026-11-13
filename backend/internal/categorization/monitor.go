package categorization

// Disagree monitor tuning. The sample stays small and recent: the worker
// reads at most recentUserLabelSample user-assigned rows per tick, and only
// warns when at least disagreeMinSamples rows are present, so a handful of
// corrections never pages the operator. A rate above
// disagreeWarnThreshold means the keyword baseline systematically answers
// differently from owners: the signal to promote matured labels into
// training or to review the serving vocabulary.
const (
	recentUserLabelSample = 20
	disagreeMinSamples    = 10
	disagreeWarnThreshold = 0.30
)

// AssignedLabel is one owner label offered to the disagree monitor.
type AssignedLabel struct {
	TransactionID string
	Category      string
	Input         Input
}

// DisagreeRate is the fraction of owner labels the decide function would
// not reproduce. An abstention counts as disagreement: a row the baseline
// cannot answer is coverage the labels could teach. It is pure so the
// threshold and the sampling stay testable without a database.
func DisagreeRate(assigned []AssignedLabel, decide func(Input) (string, bool)) float64 {
	if len(assigned) == 0 || decide == nil {
		return 0
	}
	disagree := 0
	for _, label := range assigned {
		got, ok := decide(label.Input)
		if !ok || got != label.Category {
			disagree++
		}
	}
	return float64(disagree) / float64(len(assigned))
}

// keywordDecision replays the serving baseline for one input. The monitor
// compares owners against keywords, not the experimental learner: keywords
// are the stable serving vocabulary, so drift here names labels worth
// promoting or vocabulary worth reviewing.
func keywordDecision(input Input) (string, bool) {
	return classifyKeyword(input)
}
