package domain

import (
	"fmt"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Chronological event ordering for history replay. This file is the single
// owner of observation/posting ordering: history replay, current position,
// and projection preparation all share it, so a second ordering engine
// must never be added elsewhere (including the frontend).
//
// An observation carries only its exact instant (ObservedAt). There is no
// canonical Date and no day-close fallback.

// dayCloseUnix returns the last second of a UTC calendar day.
func dayCloseUnix(date string) int64 {
	return MustParseIsoDate(date).Add(24*time.Hour - time.Second).Unix()
}

// ParseAsOfCut resolves an as-of cut to an instant and its calendar day.
// A "YYYY-MM-DD" date means the legacy date-only cut at the end of that
// UTC day (inclusive, backward compatible). An RFC 3339 timestamp means
// that exact instant. Anything else is an error.
func ParseAsOfCut(asOf string) (cutInstant int64, cutDate string, err error) {
	if IsValidIsoDate(asOf) {
		return dayCloseUnix(asOf), asOf, nil
	}
	instant, parseErr := time.Parse(time.RFC3339, asOf)
	if parseErr != nil {
		return 0, "", fmt.Errorf("as-of cut must be a YYYY-MM-DD calendar date or an RFC 3339 timestamp (got %q)", asOf)
	}
	return instant.Unix(), FormatIsoDate(instant.UTC()), nil
}

// CheckpointInstant returns the ordering instant of one observation: its
// required exact Unix time. Validation rejects zero instants; the runtime
// never invents timestamps.
func CheckpointInstant(checkpoint types.Checkpoint) int64 {
	return checkpoint.ObservedAt
}

// IsSyncCheckpoint reports bank-owned observations. Row authorship is
// "user" (owner-authored, including the legacy "model" value) or a
// sync-owned name set by the server; any other non-empty author is
// system-owned sync output, matched by exclusion rather than by name.
func IsSyncCheckpoint(source string) bool {
	return source != "" && source != "user" && source != "model"
}

// IsOwnerAuthored reports owner-authored rows.
func IsOwnerAuthored(source string) bool {
	return !IsSyncCheckpoint(source)
}

// SortObservations orders observations chronologically for replay. Ties on
// the same instant apply sync rows before owner rows, so an
// owner-authored observation wins at the same instant. Other ties keep
// document order (stable).
func SortObservations(observations []types.Checkpoint) {
	sort.SliceStable(observations, func(i, j int) bool {
		left, right := CheckpointInstant(observations[i]), CheckpointInstant(observations[j])
		if left != right {
			return left < right
		}
		leftOwner, rightOwner := IsOwnerAuthored(observations[i].Source), IsOwnerAuthored(observations[j].Source)
		if leftOwner != rightOwner {
			return !leftOwner && rightOwner
		}
		return false
	})
}

// EffectiveOccurrenceInstant is the instant an occurrence replays or
// simulates at: confirmed actuals carry their stored Unix time (including
// 00:00 — every stored posting time is timed); rule instances take effect
// in the day-close phase of their date.
func EffectiveOccurrenceInstant(occurrence DatedPostingOccurrence, date string) int64 {
	if occurrence.Rule != nil {
		return dayCloseUnix(date)
	}
	return PostingInstant(occurrence.Posting)
}

// PostingInstant returns the ordering instant of one posting: transaction
// time with posted time as fallback, matching postingDay.
func PostingInstant(posting *types.Posting) int64 {
	if posting.TransactionTime > 0 {
		return posting.TransactionTime
	}
	return posting.PostedTime
}

// ObservationAtOrBefore reports whether an observation instant falls at or
// before a cut instant.
func ObservationAtOrBefore(instant, cut int64) bool {
	return instant <= cut
}
