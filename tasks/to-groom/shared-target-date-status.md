# Two target evaluations: share the verdict rule

`Reach $1,000,000 net worth` and `Emergency fund reaches $30,000` ask different financial questions but display the same reached-date/probability shape. Their date collection and result calculation already share an implementation. Only verdict selection remains duplicated.

Extract that verdict rule into one helper using the existing `reachedDateResult` interface. Delete or alias the unused `AccountBalanceProbabilisticResult` type. The two target scans remain separate. The helper expresses the existing reached-date and `probability >= 0.5` rule.

- Shared result calculation: `backend/internal/domain/evaluation_threshold.go:33-81`, `backend/internal/domain/evaluation_account_balance.go:105-113`.
- Remaining duplicate: `backend/internal/domain/evaluation_threshold.go:130-144`, `backend/internal/domain/evaluation_account_balance.go:107-121`.
- Unused type: `backend/internal/domain/evaluation_account_balance.go:25-31`.
- Tests: `backend/internal/domain/evaluation_account_balance_test.go:26-88,137-156`.

[The older target-date task](../combine-goal-date-paths.md) overstates the remaining work. Reconcile it with this smaller scope instead of introducing another evaluation framework.

Verify crossing/non-crossing results, no crossings, probability at and below `0.5`, historical-row exclusion, and missing accounts. A missing account must not count as a zero balance. The repeated regions contain 15 identical lines. Net savings remain unmeasured.
