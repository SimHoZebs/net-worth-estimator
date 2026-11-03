package sqlite

import (
	"time"
)

// Dirty marking maps every model write to the earliest affected Unix instant.
// Readers rebuild the suffix from dirty_from; an early date rebuilds more.
// Zero means projection start when one is frozen, or clean-room revision-only
// invalidation when no start exists yet.

// markDirty records the earliest of the given instants. A non-positive entry
// means projection start and wins, because nothing predates it.
func (s *sqliteStore) markDirty(unixTimes ...int64) error {
	earliest := int64(0)
	for _, unix := range unixTimes {
		if unix <= 0 {
			return s.markDirtyStart()
		}
		if earliest == 0 || unix < earliest {
			earliest = unix
		}
	}
	if earliest == 0 {
		return nil
	}
	_, err := s.MarkProjectionDirty(earliest)
	return err
}

func (s *sqliteStore) markDirtyStart() error {
	_, err := s.MarkProjectionDirty(0)
	return err
}

// dirtyDay maps a YYYY-MM-DD date to its UTC midnight instant, or zero.
func dirtyDay(day string) int64 {
	if day == "" {
		return 0
	}
	moment, err := time.Parse("2006-01-02", day)
	if err != nil {
		return 0
	}
	return moment.UTC().Unix()
}

// dirtyPosting returns the earlier of a posting's two stored times.
func dirtyPosting(postedTime, transactionTime int64) int64 {
	if postedTime <= 0 {
		return transactionTime
	}
	if transactionTime <= 0 || transactionTime >= postedTime {
		return postedTime
	}
	return transactionTime
}

// dirtyFromSync returns the earliest affected instant across sync
// checkpoints and bank directives. Zero when the plan is empty.
func dirtyFromSync(checkpoints []SyncCheckpoint, directives []BankDirective) (int64, bool) {
	earliest := int64(0)
	note := func(unix int64) {
		if unix <= 0 {
			return
		}
		if earliest == 0 || unix < earliest {
			earliest = unix
		}
	}
	for _, checkpoint := range checkpoints {
		note(checkpoint.ObservedAt)
	}
	for _, directive := range directives {
		switch {
		case directive.Upsert != nil:
			note(directive.Upsert.Posting.PostedTime)
			note(directive.Upsert.Posting.TransactionTime)
		case directive.Convert != nil:
			note(directive.Convert.Posting.PostedTime)
			note(directive.Convert.Posting.TransactionTime)
		}
	}
	if earliest == 0 {
		return 0, false
	}
	return earliest, true
}
