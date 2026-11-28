---
id: 136
title: Normalize numeric amounts before saving bank data
scope: contracts-types
status: accepted
---

SimpleFIN checks incoming numbers with Go's floating-point parser, then stores the original transaction spelling as an arithmetic expression. The expression evaluator accepts a narrower syntax. A number such as `1e3` can therefore pass sync translation but fail when the saved model evaluates it. Other readers disagree about surrounding spaces, including when a transaction is used to create a schedule.

Share a numeric amount parser across sync translation and the backend's numeric-only readers. Reject non-finite values, preserve valid decimal spelling, and normalize supported numeric forms before writing bank transactions as expressions. Keep each caller's existing sign and eligibility rules.

## References

- `backend/internal/simplefin/sync_translation.go:57-87,163-197` parses and stores bank amounts.
- `backend/internal/domain/arithmetic.go:59-111` defines the expression syntax.
- `backend/internal/store/feed.go:16-28` and `backend/internal/api/model/transactions.go:457-468` show the differing numeric readers.

## Verification

Source comparison confirms that translation and evaluation use different syntax checks and that the numeric readers handle whitespace differently.

Verify ordinary decimals, padded values and supported alternate numeric forms through translation, storage and model evaluation. Check that invalid values are skipped through existing error paths and that creating a schedule from a valid padded amount works.
