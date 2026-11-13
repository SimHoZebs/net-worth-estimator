package categorization

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type fakeJournalStore struct {
	rows []types.CategoryFeedback
	err  error
}

func (f *fakeJournalStore) ListCategoryFeedback(after string, limit int) ([]types.CategoryFeedback, error) {
	if f.err != nil {
		return nil, f.err
	}
	base := int64(0)
	if after != "" {
		var err error
		base, err = parseStoreCursor(after)
		if err != nil {
			return nil, err
		}
	}
	out := []types.CategoryFeedback{}
	for _, row := range f.rows {
		if row.Seq <= base {
			continue
		}
		out = append(out, row)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func parseStoreCursor(after string) (int64, error) {
	return strconv.ParseInt(after, 10, 64)
}

func journalRow(seq int64, transactionID, action string, category *string, name, direction string, createdAt int64) types.CategoryFeedback {
	return types.CategoryFeedback{
		Seq: seq, ID: fmt.Sprintf("%020d", seq),
		TransactionID: transactionID, Action: action, Category: category,
		Name: name, Direction: direction,
		Facts:     &types.TransactionFacts{Description: name, Amount: "-42.00", Currency: "USD", PostedTime: createdAt},
		CreatedAt: createdAt,
	}
}

func categoryKey(value string) *string { return &value }

func fixedJournalSource(store journalStore, now time.Time) *journalFeedbackSource {
	source := newJournalFeedbackSource(store, "owner-1")
	source.now = func() time.Time { return now }
	return source
}

var journalNow = time.Unix(1785628800, 0)

func matured(at time.Time) int64 { return at.Add(-judgment.FeedbackQuarantine).Unix() }

func TestJournalPageDeliversMaturedAssign(t *testing.T) {
	rows := []types.CategoryFeedback{
		journalRow(1, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryTransportation), "SHELL OIL", "out", matured(journalNow)),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 1 {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	item := page.Feedback[0]
	if item.EventID != "00000000000000000001:00" || item.RunID != CategoryFeedbackRunID || item.Action != "confirm" {
		t.Fatalf("item=%+v", item)
	}
	if item.Request.Kind != "category:TRANSPORTATION" {
		t.Fatalf("request=%+v", item.Request)
	}
	if page.Cursor != item.EventID {
		t.Fatalf("cursor=%q", page.Cursor)
	}
	if source.Owner() != "categorization:owner-1" {
		t.Fatalf("owner=%q", source.Owner())
	}
}

func TestJournalPageQuarantineBoundary(t *testing.T) {
	mature := journalRow(1, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryTransportation), "SHELL OIL", "out", matured(journalNow))
	held := journalRow(2, "txn-2", types.CategoryFeedbackAssign, categoryKey(types.CategoryTransportation), "SHELL OIL", "out", matured(journalNow)+1)
	source := fixedJournalSource(&fakeJournalStore{rows: []types.CategoryFeedback{mature, held}}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	// The matured row delivers; the one-second-young row holds the cursor
	// behind it instead of training early.
	if len(page.Feedback) != 1 || page.Feedback[0].EventID != "00000000000000000001:00" {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	if page.Cursor != "00000000000000000001:00" {
		t.Fatalf("cursor advanced past a fresh row=%q", page.Cursor)
	}
	next, err := source.Page(page.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Feedback) != 0 || next.Cursor != page.Cursor {
		t.Fatalf("fresh row leaked=%+v cursor=%q", next.Feedback, next.Cursor)
	}
}

func TestJournalPageSupersessionMatrix(t *testing.T) {
	for _, tc := range []struct {
		name          string
		first, second string
		wantAssign    *string // nil means the surviving row is a clear
		wantConfirms  int
		wantRejects   int
	}{
		{"assignAssign", types.CategoryFeedbackAssign, types.CategoryFeedbackAssign, categoryKey(types.CategoryEntertainment), 1, 1},
		{"assignClear", types.CategoryFeedbackAssign, types.CategoryFeedbackClear, nil, 0, 2},
		{"clearAssign", types.CategoryFeedbackClear, types.CategoryFeedbackAssign, categoryKey(types.CategoryFoodAndDrink), 1, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := []types.CategoryFeedback{
				journalRow(1, "txn-1", tc.first, categoryKey(types.CategoryTransportation), "NETFLIX WHOLE FOODS", "out", matured(journalNow)),
				journalRow(2, "txn-1", tc.second, tc.wantAssign, "NETFLIX WHOLE FOODS", "out", matured(journalNow)),
			}
			// A clear row carries the removed key; the want category for
			// the surviving assign is the asserted label.
			if tc.second == types.CategoryFeedbackClear {
				removed := types.CategoryTransportation
				rows[1].Category = &removed
			}
			source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
			page, err := source.Page("", 200)
			if err != nil {
				t.Fatal(err)
			}
			confirms, rejects := 0, 0
			for _, item := range page.Feedback {
				if got := item.EventID[:20]; got != "00000000000000000002" {
					t.Fatalf("superseded row trained=%+v", page.Feedback)
				}
				switch item.Action {
				case "confirm":
					confirms++
				case "reject":
					rejects++
				default:
					t.Fatalf("action=%q", item.Action)
				}
			}
			if confirms != tc.wantConfirms || rejects != tc.wantRejects {
				t.Fatalf("confirms=%d rejects=%d feedback=%+v", confirms, rejects, page.Feedback)
			}
			if page.Cursor != page.Feedback[len(page.Feedback)-1].EventID {
				t.Fatalf("cursor=%q", page.Cursor)
			}
		})
	}
}

func TestJournalPageClearExpandsToRejects(t *testing.T) {
	removed := types.CategoryTransportation
	rows := []types.CategoryFeedback{
		journalRow(7, "txn-7", types.CategoryFeedbackClear, &removed, "SHELL OIL", "out", matured(journalNow)),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 1 {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	item := page.Feedback[0]
	if item.Action != "reject" || item.EventID != "00000000000000000007:00" || item.RunID != CategoryFeedbackRunID {
		t.Fatalf("item=%+v", item)
	}
	if item.Request.Kind != "category:TRANSPORTATION" {
		t.Fatalf("request=%+v", item.Request)
	}
}

func TestJournalPageNilClearExpandsToNothing(t *testing.T) {
	rows := []types.CategoryFeedback{
		journalRow(8, "txn-8", types.CategoryFeedbackClear, nil, "SHELL OIL", "out", matured(journalNow)),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 0 {
		t.Fatalf("nil-clear trained: %+v", page.Feedback)
	}
}

func TestJournalPageOrderingAndSubIDs(t *testing.T) {
	rows := []types.CategoryFeedback{
		journalRow(1, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryEntertainment), "NETFLIX WHOLE FOODS", "out", matured(journalNow)),
		journalRow(2, "txn-2", types.CategoryFeedbackAssign, categoryKey(types.CategoryTransportation), "SHELL OIL", "out", matured(journalNow)),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	full, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Feedback) != 3 {
		t.Fatalf("feedback=%+v", full.Feedback)
	}
	// Every emitted ID belongs to its page interval and orders strictly.
	previous := ""
	for _, item := range full.Feedback {
		if item.EventID <= previous || item.EventID <= "" || item.EventID > full.Cursor {
			t.Fatalf("unordered interval item=%+v cursor=%q", item, full.Cursor)
		}
		previous = item.EventID
	}
	first, err := source.Page("", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Feedback) != 2 || first.Cursor != full.Feedback[1].EventID {
		t.Fatalf("first=%+v", first)
	}
	second, err := source.Page(first.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Feedback) != 1 || second.Feedback[0].EventID != full.Feedback[2].EventID || second.Cursor != full.Cursor {
		t.Fatalf("second=%+v full=%+v", second, full)
	}
}

func TestJournalPageCursorSkipsSuperseded(t *testing.T) {
	rows := []types.CategoryFeedback{
		journalRow(1, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryMedical), "NETFLIX WHOLE FOODS", "out", matured(journalNow)),
		journalRow(2, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryEntertainment), "NETFLIX WHOLE FOODS", "out", matured(journalNow)),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 2 {
		t.Fatalf("feedback=%+v", page.Feedback)
	}
	// The cursor advanced past the absorbed sequence in one page.
	if page.Cursor != "00000000000000000002:01" {
		t.Fatalf("cursor=%q", page.Cursor)
	}
	// A later page resumes past both sequences without redelivery.
	again, err := source.Page(page.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Feedback) != 0 || again.Cursor != page.Cursor {
		t.Fatalf("redelivery=%+v cursor=%q", again.Feedback, again.Cursor)
	}
}

func TestJournalPageWatermarkAbsorbsTrailingSuperseded(t *testing.T) {
	old := matured(journalNow)
	rows := []types.CategoryFeedback{
		journalRow(1, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryMedical), "SHELL OIL", "out", old),
		journalRow(2, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryTransportation), "SHELL OIL", "out", old),
		// The newest mind is still young, so nothing may train yet.
		journalRow(3, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryFoodAndDrink), "SHELL OIL", "out", journalNow.Unix()),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 0 {
		t.Fatalf("young label trained=%+v", page.Feedback)
	}
	// Superseded rows are absorbed by advancing past them; the cursor
	// still stays behind the unmatured tail.
	if page.Cursor != "00000000000000000002:00" {
		t.Fatalf("cursor=%q", page.Cursor)
	}
	held, err := source.Page(page.Cursor, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(held.Feedback) != 0 || held.Cursor != page.Cursor {
		t.Fatalf("held=%+v cursor=%q", held.Feedback, held.Cursor)
	}
}

func TestJournalPageTrainingGatePausesDelivery(t *testing.T) {
	t.Setenv("ML_TRAINING", "0")
	rows := []types.CategoryFeedback{
		journalRow(1, "txn-1", types.CategoryFeedbackAssign, categoryKey(types.CategoryTransportation), "SHELL OIL", "out", matured(journalNow)),
	}
	source := fixedJournalSource(&fakeJournalStore{rows: rows}, journalNow)
	page, err := source.Page("", 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Feedback) != 0 || page.Cursor != "" {
		t.Fatalf("gate ignored=%+v", page)
	}
}

func TestJournalPageRejectsMalformedCursor(t *testing.T) {
	source := fixedJournalSource(&fakeJournalStore{}, journalNow)
	for _, after := range []string{"bogus", "1", "00000000000000000001", "00000000000000000001:1", "00000000000000000001:00:00"} {
		if _, err := source.Page(after, 200); err == nil {
			t.Fatalf("cursor %q was accepted", after)
		}
	}
}
