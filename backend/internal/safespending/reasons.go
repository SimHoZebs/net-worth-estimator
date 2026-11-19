package safespending

// Reason codes emitted in SafeSpendingSummary.Reasons, baseline reasons and
// obligation reasons. They are the single source for both emission and the
// availability gate in BuildAtCut.
const (
	ReasonFutureCycle                         = "future-cycle"
	ReasonPostedRoutingUnknown                = "posted-routing-unknown"
	ReasonPostedAmountUnavailable             = "posted-amount-unavailable"
	ReasonCashBaselineMissing                 = "cash-baseline-missing"
	ReasonPendingAfterBaselineCoverageUnknown = "pending-after-baseline-coverage-unknown"
	ReasonPendingHoldWithoutAvailableBalance  = "pending-hold-without-available-balance"
	ReasonPostedHoldCoverageUnknown           = "posted-hold-coverage-unknown"
	ReasonCashAccountsMissing                 = "cash-accounts-missing"
	ReasonObligationRoutingUnknown            = "obligation-routing-unknown"
	ReasonObligationAmountUnavailable         = "obligation-amount-unavailable"
	ReasonNegativeObligationAmount            = "negative-obligation-amount"
	ReasonPaydayUnavailable                   = "payday-unavailable"
	ReasonIncomeUnavailable                   = "income-unavailable"
	ReasonStatementBalanceUnavailable         = "statement-balance-unavailable"
	ReasonStatementEstimateUnavailable        = "statement-estimate-unavailable"
)
