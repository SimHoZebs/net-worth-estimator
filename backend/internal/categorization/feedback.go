package categorization

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// CategoryFeedbackRunID is the review session every journal-derived
// training event carries. The learner requires a non-empty run ID; the
// journal has no analysis runs, so the constant names the stream.
const CategoryFeedbackRunID = "category-feedback"

// journalStore is the scoped journal read the feedback source pages
// through. store.Store implements it; the source keeps the narrow seam so
// Page stays testable without a database.
type journalStore interface {
	ListCategoryFeedback(after string, limit int) ([]types.CategoryFeedback, error)
}

// journalFeedbackSource delivers matured user labels as training feedback
// through the normal session-open path. Page enforces two gates the store
// knows nothing about:
//
//   - Quarantine: only rows created at least judgment.FeedbackQuarantine
//     ago are eligible. Fresh rows stop the page with the cursor held
//     behind them, so a hasty correction never trains.
//   - Latest wins: only the newest row per transaction expands. Older rows
//     are absorbed by advancing past them, so a changed mind never trains
//     the label it replaced.
//
// Each journal row expands to one feedback item per request the rebuilt
// serving request set emits: a confirm for the assigned kind, rejects for
// every other kind. A clear expands to rejects only. Item event IDs share
// the row's zero-padded sequence prefix as "seq:slot" (slot 00 is the
// confirm; rejects follow in kind order), so IDs are unique and strictly
// ordered within (after, cursor], and the page cursor is the last emitted
// item ID. The expansion rebuilds requests with CategoryJudgmentRequests
// on the stored snapshot: deterministic, and the same builder as serving.
type journalFeedbackSource struct {
	store journalStore
	owner string
	now   func() time.Time
}

func newJournalFeedbackSource(store journalStore, owner string) *journalFeedbackSource {
	return &journalFeedbackSource{store: store, owner: owner, now: time.Now}
}

// Owner namespaces the user under the feature. Payment checkpoints use the
// bare user ID against the same deployment-wide learner, so sharing it
// would interleave two unrelated event-ID streams under one checkpoint and
// break the provider's checkpoint-interval rule.
func (s *journalFeedbackSource) Owner() string { return "categorization:" + s.owner }

// formatJournalEventID renders one expanded item ID. The width matches the
// store's zero-padded sequence IDs, so lexicographic order is sequence
// order, then slot order.
func formatJournalEventID(seq int64, slot int) string {
	return fmt.Sprintf("%020d:%02d", seq, slot)
}

// parseJournalEventCursor resolves a page cursor back to its sequence and
// slot. The empty cursor is the head of the journal.
func parseJournalEventCursor(after string) (seq int64, slot int, err error) {
	if after == "" {
		return 0, -1, nil
	}
	parts := strings.Split(after, ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid category feedback cursor %q", after)
	}
	seq, err = strconv.ParseInt(parts[0], 10, 64)
	if err != nil || seq <= 0 || fmt.Sprintf("%020d", seq) != parts[0] {
		return 0, 0, fmt.Errorf("invalid category feedback cursor %q", after)
	}
	slot, err = strconv.Atoi(parts[1])
	if err != nil || slot < 0 || slot > 99 || fmt.Sprintf("%02d", slot) != parts[1] {
		return 0, 0, fmt.Errorf("invalid category feedback cursor %q", after)
	}
	return seq, slot, nil
}

func (s *journalFeedbackSource) Page(after string, limit int) (judgment.FeedbackPage, error) {
	page := judgment.FeedbackPage{Cursor: after, Feedback: []judgment.Feedback{}}
	if !judgment.TrainingEnabled() {
		return page, nil
	}
	if limit <= 0 {
		limit = 200
	}
	baseSeq, baseSlot, err := parseJournalEventCursor(after)
	if err != nil {
		return judgment.FeedbackPage{}, err
	}
	// Latest-wins needs the tail past the page: a newer row anywhere
	// beyond the limit still supersedes an older row inside it. Journal
	// volume is user actions, so a full tail scan per page is cheap.
	var rows []types.CategoryFeedback
	cursor := ""
	if baseSeq > 0 {
		cursor = fmt.Sprintf("%020d", baseSeq-1)
	}
	for {
		batch, err := s.store.ListCategoryFeedback(cursor, 500)
		if err != nil {
			return judgment.FeedbackPage{}, err
		}
		rows = append(rows, batch...)
		if len(batch) < 500 {
			break
		}
		cursor = batch[len(batch)-1].ID
	}
	latest := map[string]int64{}
	for _, row := range rows {
		if row.Seq >= baseSeq && row.Seq > latest[row.TransactionID] {
			latest[row.TransactionID] = row.Seq
		}
	}
	cutoff := s.now().Add(-judgment.FeedbackQuarantine).Unix()
	emitted := 0
	watermark := ""
	for _, row := range rows {
		if row.Seq < baseSeq {
			continue
		}
		if latest[row.TransactionID] != row.Seq {
			// Superseded: an older mind, already replaced. Advance past
			// it without emitting so it never trains.
			if row.Seq > baseSeq {
				watermark = formatJournalEventID(row.Seq, 0)
			}
			continue
		}
		if row.CreatedAt > cutoff {
			// The newest row for this transaction is still young. Stop
			// with the cursor behind it; it matures on a later tick.
			// Journal sequence order matches creation order, so later
			// rows are younger too.
			break
		}
		items := expandJournalRow(row)
		if row.Seq == baseSeq {
			// Resume inside a partially delivered row: drop the slots
			// the previous page already emitted.
			if baseSlot+1 >= len(items) {
				continue
			}
			items = items[baseSlot+1:]
		}
		for _, item := range items {
			if emitted >= limit {
				return page, nil
			}
			page.Feedback = append(page.Feedback, item)
			page.Cursor = item.EventID
			emitted++
		}
	}
	if emitted == 0 && watermark != "" {
		// Nothing was deliverable, but superseded rows were absorbed:
		// move the checkpoint past them so the next page skips them.
		page.Cursor = watermark
	}
	return page, nil
}

// expandJournalRow converts one matured, latest journal row into training
// items. An assign confirms the assigned kind and rejects every other kind
// the rebuilt request set emits; a clear rejects every emitted kind. When
// the assigned kind emits no request (direction-gated, or signal-free),
// the row contributes rejects only: the row is still evidence against the
// emitted kinds, just not for the missing one. A clear with no removed key
// removed nothing and expands to nothing.
func expandJournalRow(row types.CategoryFeedback) []judgment.Feedback {
	confirming := row.Action == types.CategoryFeedbackAssign && row.Category != nil
	if row.Action == types.CategoryFeedbackClear && row.Category == nil {
		// Clearing nothing labels nothing: no removed key, no evidence.
		return nil
	}
	assigned := ""
	if confirming {
		assigned = "category:" + strings.TrimSpace(*row.Category)
	}
	input := Input{TransactionID: row.TransactionID, Name: row.Name, Direction: row.Direction, Facts: row.Facts}
	requests := CategoryJudgmentRequests(input)
	sort.Slice(requests, func(i, j int) bool { return requests[i].Kind < requests[j].Kind })
	items := []judgment.Feedback{}
	slot := 0
	if confirming {
		for _, request := range requests {
			if request.Kind != assigned {
				continue
			}
			items = append(items, judgment.Feedback{EventID: formatJournalEventID(row.Seq, slot), RunID: CategoryFeedbackRunID, Action: "confirm", Request: request})
			slot++
		}
	}
	for _, request := range requests {
		if confirming && request.Kind == assigned {
			continue
		}
		items = append(items, judgment.Feedback{EventID: formatJournalEventID(row.Seq, slot), RunID: CategoryFeedbackRunID, Action: "reject", Request: request})
		slot++
	}
	return items
}
