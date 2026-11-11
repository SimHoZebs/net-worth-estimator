package analysis

import (
	"context"
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type observationsKey struct{}
type observationCache struct {
	owner    string
	revision int64
	streams  []*paymentStream
	loaded   bool
}

// A runner pass owns this short-lived cache. Bank revisions distinguish snapshots;
// independent assessments never mutate these shared observations or user answers.
func withPaymentObservations(ctx context.Context) context.Context {
	return context.WithValue(ctx, observationsKey{}, &observationCache{})
}

func detectPaymentStreams(ctx context.Context, input types.AnalysisSnapshot) ([]*paymentStream, error) {
	cache, _ := ctx.Value(observationsKey{}).(*observationCache)
	if cache != nil && cache.loaded && cache.owner == input.UserID && cache.revision == input.Revision {
		return cache.streams, ctx.Err()
	}
	transfers, err := paymentTransferIDs(ctx, input.Transactions)
	if err != nil {
		return nil, err
	}
	groups, err := paymentGroups(ctx, input.Transactions)
	if err != nil {
		return nil, err
	}
	var latest = latestPaymentDay(input.Transactions)
	streams := make([]*paymentStream, 0, len(groups))
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		streams = append(streams, observePaymentStream(input.UserID, group, group.candidates, transfers, latest))
	}
	if cache != nil {
		*cache = observationCache{owner: input.UserID, revision: input.Revision, streams: streams, loaded: true}
	}
	return streams, nil
}

// latestPaymentDay is the global recency anchor shared by every stream view.
func latestPaymentDay(transactions []types.AnalysisTransaction) int64 {
	var latest int64
	for _, tx := range transactions {
		if !tx.Pending && !tx.Void {
			latest = max(latest, paymentStamp(tx.Facts)/86400)
		}
	}
	return latest
}

// observePaymentStream summarizes one identity group and its external-only
// view. The incremental path reuses it for affected groups only, so
// recomputed statistics match full detection exactly.
func observePaymentStream(owner string, group paymentGroup, candidates []paymentOccurrence, transfers map[string]bool, latest int64) *paymentStream {
	stream := observePaymentGroup(owner, group, candidates, latest)
	var external []paymentOccurrence
	for _, item := range candidates {
		if !transfers[item.transaction.TransactionID] && !paymentRefundMarker.MatchString(item.text) {
			external = append(external, item)
		}
	}
	if len(external) > 0 {
		if len(external) == len(candidates) {
			stream.external = stream
		} else {
			stream.external = observePaymentGroup(owner, group, external, latest)
		}
	}
	return stream
}

func observePaymentGroup(owner string, group paymentGroup, items []paymentOccurrence, latest int64) *paymentStream {
	items = append([]paymentOccurrence(nil), items...)
	sort.Slice(items, func(i, j int) bool {
		if items[i].day != items[j].day {
			return items[i].day < items[j].day
		}
		return items[i].transaction.TransactionID < items[j].transaction.TransactionID
	})
	stream := summarizePayments(owner, group, items, latest)
	var kept []paymentOccurrence
	var remainder []paymentOccurrence
	for _, item := range items {
		if math.Abs(math.Abs(item.amount)-stream.typical) <= recurringTolerance*stream.typical {
			kept = append(kept, item)
		} else {
			remainder = append(remainder, item)
		}
	}
	if len(kept) < 2 {
		return stream
	}
	repeating := summarizePayments(owner, group, kept, latest)
	if repeating.medianGap <= 0 {
		return stream
	}
	for _, option := range paymentCadences {
		if len(kept) < option.minOcc || math.Abs(repeating.medianGap-option.days) > recurringTolerance*option.days {
			continue
		}
		regular := true
		for i := 1; i < len(kept); i++ {
			gap := float64(kept[i].day - kept[i-1].day)
			regular = regular && math.Abs(gap-repeating.medianGap) <= recurringTolerance*repeating.medianGap
		}
		if !regular {
			continue
		}
		repeating.typical = stream.typical
		repeating.cadence = option.id
		repeating.cadenceDays = option.days
		repeating.annualized = stream.typical * option.factor
		repeating.patternID = paymentPatternID(owner, group.key, option.id)
		repeating.signals = append(repeating.signals, "regular-cadence")
		sort.Strings(repeating.signals)
		stream.recurrence = repeating
		if len(remainder) > 0 {
			stream.nonrepeating = summarizePayments(owner, group, remainder, latest)
		}
		break
	}
	return stream
}

func summarizePayments(owner string, group paymentGroup, items []paymentOccurrence, latest int64) *paymentStream {
	amounts := make([]float64, 0, len(items))
	gaps := make([]float64, 0, max(0, len(items)-1))
	for i, item := range items {
		amounts = append(amounts, math.Abs(item.amount))
		if i > 0 {
			gaps = append(gaps, float64(item.day-items[i-1].day))
		}
	}
	var gap float64
	if len(gaps) > 0 {
		gap = paymentMedian(gaps)
	}
	return &paymentStream{streamID: paymentPatternID(owner, group.key, ""), patternID: paymentPatternID(owner, group.key, ""), merchant: group.merchant, currency: items[0].transaction.Facts.Currency, direction: group.direction,
		typical: paymentMedian(amounts), amountCV: paymentCV(amounts), gapCV: paymentCV(gaps), medianGap: gap, recencyDays: float64(latest - items[len(items)-1].day), occurrences: items, signals: paymentSignals(items)}
}
