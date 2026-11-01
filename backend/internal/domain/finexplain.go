package domain

import (
	"fmt"
	"math"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Data-sufficiency and recommendation explainability (FIN-05). This layer
// wraps a FIN-03 FinancialHealthReport with the evidence quality behind
// it: per-account balance sources, cut-relative freshness, window
// coverage, and the actions that evidence supports.
//
// It never recomputes check verdicts and never claims complete fitness
// from incomplete records: any missing, stale, or unresolvable evidence
// grades the explanation incomplete, and incompleteness is reported as a
// limitation, never as failure.

const finExplainSecondsPerDay = 86400.0

// finExplainCheckLabels names checks in action titles.
var finExplainCheckLabels = map[string]string{
	types.FinancialHealthCheckEmergencyCoverage:      "emergency coverage",
	types.FinancialHealthCheckCashFlowSustainability: "cash-flow sustainability",
	types.FinancialHealthCheckDebtBurden:             "debt burden",
	types.FinancialHealthCheckHighInterestDebt:       "high-interest debt",
	types.FinancialHealthCheckSavingsRate:            "savings rate",
	types.FinancialHealthCheckUtilization:            "utilization",
	types.FinancialHealthCheckSpendingConsistency:    "spending consistency",
}

// finExplainBalanceChecks are the checks that read as-of balances, so
// stale or missing observations limit them.
var finExplainBalanceChecks = []string{
	types.FinancialHealthCheckEmergencyCoverage,
	types.FinancialHealthCheckDebtBurden,
	types.FinancialHealthCheckHighInterestDebt,
	types.FinancialHealthCheckUtilization,
}

// NormalizeFinancialHealthExplanationOptions clamps options to a usable
// shape: the recency limit falls back to the default when unset.
func NormalizeFinancialHealthExplanationOptions(options types.FinancialHealthExplanationOptions) types.FinancialHealthExplanationOptions {
	if options.StaleAfterDays < 1 {
		options.StaleAfterDays = types.DefaultFinancialHealthExplanationOptions().StaleAfterDays
	}
	return options
}

// finExplainRound1 rounds a day age to one decimal for display.
func finExplainRound1(value float64) float64 { return math.Round(value*10) / 10 }

func finExplainCopyEvidence(evidence []types.FinancialHealthEvidenceItem) []types.FinancialHealthEvidenceItem {
	copied := make([]types.FinancialHealthEvidenceItem, 0, len(evidence))
	for _, item := range evidence {
		duplicate := item
		duplicate.AccountIDs = append([]string(nil), item.AccountIDs...)
		duplicate.PostingIDs = append([]string(nil), item.PostingIDs...)
		copied = append(copied, duplicate)
	}
	return copied
}

func finExplainCopyTargets(targets map[string]float64) map[string]float64 {
	copied := make(map[string]float64, len(targets))
	for key, value := range targets {
		copied[key] = value
	}
	return copied
}

func finExplainCheckByID(report types.FinancialHealthReport, checkID string) *types.FinancialHealthCheckResult {
	for index := range report.Checks {
		if report.Checks[index].CheckID == checkID {
			return &report.Checks[index]
		}
	}
	return nil
}

func finExplainEnabledAccounts(model *types.FinancialModel) []types.Account {
	accounts := []types.Account{}
	if model == nil {
		return accounts
	}
	for _, account := range model.Accounts {
		if account.Enabled {
			accounts = append(accounts, account)
		}
	}
	return accounts
}

// finExplainLatestObservations returns the latest checkpoint at or before
// the cut per account. Disabled accounts are out of scope; observations
// after the cut do not exist yet from the report's point of view.
func finExplainLatestObservations(model *types.FinancialModel, cutInstant int64) map[string]types.Checkpoint {
	latest := map[string]types.Checkpoint{}
	if model == nil {
		return latest
	}
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.ObservedAt <= 0 || checkpoint.ObservedAt > cutInstant {
			continue
		}
		current, ok := latest[checkpoint.AccountID]
		if !ok || checkpoint.ObservedAt > current.ObservedAt {
			latest[checkpoint.AccountID] = checkpoint
		}
	}
	return latest
}

// ExplainFinancialHealth grades the evidence behind a FIN-03 report and
// proposes actions that evidence supports. Proposed actions always link
// back to check evidence and to the user-configurable targets they move;
// the summary never presents an overall passing assessment unless the
// records are complete.
func ExplainFinancialHealth(model *types.FinancialModel, position *types.CurrentPosition, report types.FinancialHealthReport, options types.FinancialHealthExplanationOptions) types.FinancialHealthExplanation {
	options = NormalizeFinancialHealthExplanationOptions(options)
	cutInstant, cutDay, err := ParseAsOfCut(report.AsOfDate)
	if err != nil || model == nil || position == nil {
		return finExplainInsufficient(report, options, "No usable saved state at the as-of cut, so no financial assessment is possible.")
	}
	enabled := finExplainEnabledAccounts(model)
	coverage := report.FlowCoverage
	if len(enabled) == 0 && coverage.ResolvedPostings == 0 {
		return finExplainInsufficient(report, options, "No usable saved state at the as-of cut, so no financial assessment is possible.")
	}

	latest := finExplainLatestObservations(model, cutInstant)
	terms := PaymentTermsByAccount(model)

	sources := make([]types.FinancialHealthAccountSource, 0, len(enabled))
	staleIDs := []string{}
	unobservedIDs := []string{}
	var newestAge, oldestAge *float64
	for _, account := range enabled {
		source := types.FinancialHealthAccountSource{
			AccountID:   account.ID,
			AccountName: account.Name,
			Kind:        account.Kind,
			Origin:      types.FinancialHealthOriginNone,
		}
		observation, ok := latest[account.ID]
		if ok {
			rawAge := float64(cutInstant-observation.ObservedAt) / finExplainSecondsPerDay
			if rawAge < 0 {
				rawAge = 0
			}
			age := finExplainRound1(rawAge)
			source.Source = observation.Source
			if IsSyncCheckpoint(observation.Source) {
				source.Origin = types.FinancialHealthOriginSync
			} else {
				source.Origin = types.FinancialHealthOriginManual
			}
			source.LastObservedAt = &observation.ObservedAt
			source.AgeDays = &age
			source.Stale = rawAge > float64(options.StaleAfterDays)
			if source.Stale {
				staleIDs = append(staleIDs, account.ID)
			}
			if newestAge == nil || age < *newestAge {
				duplicate := age
				newestAge = &duplicate
			}
			if oldestAge == nil || age > *oldestAge {
				duplicate := age
				oldestAge = &duplicate
			}
		} else {
			unobservedIDs = append(unobservedIDs, account.ID)
		}
		sources = append(sources, source)
	}

	unknownLiabilities := []string{}
	balances := make(map[string]float64, len(position.Accounts))
	for _, row := range position.Accounts {
		balances[row.AccountID] = row.Balance
	}
	for _, account := range enabled {
		if account.Kind != types.AccountKindDebt {
			continue
		}
		if _, ok := terms[account.ID]; ok {
			continue
		}
		// A paid-off debt account has no required minimums, matching the
		// debt-burden check: only a carried balance without terms leaves
		// the liability unknown. A missing position row keeps the
		// account flagged, since its balance cannot be confirmed as zero.
		balance, ok := balances[account.ID]
		if !ok || balance < 0 {
			unknownLiabilities = append(unknownLiabilities, account.ID)
		}
	}

	flowSources := finExplainFlowSources(model, report)
	coverageOut := types.FinancialHealthCoverage{
		WindowPostings:             coverage.WindowPostings,
		ResolvedPostings:           coverage.ResolvedPostings,
		ExcludedPostings:           coverage.ExcludedPostings,
		ExcludedIDs:                append([]string{}, coverage.ExcludedIDs...),
		MissingIncome:              coverage.InflowTotal <= 0,
		MissingOutflow:             coverage.OutflowTotal <= 0,
		UnknownLiabilityAccountIDs: unknownLiabilities,
		FlowSources:                flowSources,
	}
	freshness := types.FinancialHealthFreshness{
		AsOfDate:                 types.IsoDate(cutDay),
		StaleAfterDays:           options.StaleAfterDays,
		NewestObservationAgeDays: newestAge,
		OldestObservationAgeDays: oldestAge,
		StaleAccountIDs:          staleIDs,
		UnobservedAccountIDs:     append([]string{}, unobservedIDs...),
	}

	insufficientChecks := []string{}
	for _, check := range report.Checks {
		if check.Status == types.FinancialHealthInsufficientData {
			insufficientChecks = append(insufficientChecks, check.CheckID)
		}
	}
	partialReasons := []string{}
	if len(insufficientChecks) > 0 {
		partialReasons = append(partialReasons, fmt.Sprintf("%d of %d checks have too little evidence to compute", len(insufficientChecks), len(report.Checks)))
	}
	if len(unobservedIDs) > 0 {
		partialReasons = append(partialReasons, fmt.Sprintf("%d account(s) have no balance observation at the cut", len(unobservedIDs)))
	}
	if len(staleIDs) > 0 {
		partialReasons = append(partialReasons, fmt.Sprintf("%d account(s) have observations older than the %d-day recency guideline", len(staleIDs), options.StaleAfterDays))
	}
	if len(unknownLiabilities) > 0 {
		partialReasons = append(partialReasons, "debt accounts lack payment terms, so required minimums are unknown")
	}
	if coverageOut.MissingIncome {
		partialReasons = append(partialReasons, "no income is recorded in the window")
	} else if coverageOut.MissingOutflow {
		partialReasons = append(partialReasons, "no spending is recorded in the window")
	}
	if coverageOut.ExcludedPostings > 0 {
		partialReasons = append(partialReasons, fmt.Sprintf("%d window posting(s) could not be resolved and are excluded from totals", coverageOut.ExcludedPostings))
	}

	completeness := types.FinancialHealthComplete
	summary := ""
	if len(partialReasons) > 0 {
		completeness = types.FinancialHealthIncomplete
		summary = fmt.Sprintf("Records are incomplete at the %s cut: %s. Treat every verdict below as limited by these gaps, not as a complete assessment.", cutDay, strings.Join(partialReasons, "; "))
	} else {
		meeting, atRisk, notMeeting := 0, 0, 0
		for _, check := range report.Checks {
			switch check.Status {
			case types.FinancialHealthMeeting:
				meeting++
			case types.FinancialHealthAtRisk:
				atRisk++
			case types.FinancialHealthNotMeeting:
				notMeeting++
			}
		}
		summary = fmt.Sprintf("Records are complete at the %s cut. All %d checks computed: %d meeting, %d at risk, %d not meeting.", cutDay, len(report.Checks), meeting, atRisk, notMeeting)
	}

	actions := finExplainActions(model, report, options, sources, coverageOut, freshness)

	return types.FinancialHealthExplanation{
		AsOfDate:     types.IsoDate(cutDay),
		Completeness: completeness,
		Summary:      summary,
		Sufficiency: types.FinancialHealthDataSufficiency{
			Completeness: completeness,
			Sources:      sources,
			Freshness:    freshness,
			Coverage:     coverageOut,
		},
		Actions: actions,
	}
}

// finExplainInsufficient reports the no-usable-state case: nothing is
// graded, one action points at recording baseline data, and no fitness is
// claimed.
func finExplainInsufficient(report types.FinancialHealthReport, options types.FinancialHealthExplanationOptions, summary string) types.FinancialHealthExplanation {
	lookback := float64(report.Standards.LookbackDays)
	if lookback < 1 {
		lookback = float64(types.DefaultFinancialHealthStandards().LookbackDays)
	}
	return types.FinancialHealthExplanation{
		AsOfDate:     report.AsOfDate,
		Completeness: types.FinancialHealthInsufficient,
		Summary:      summary,
		Sufficiency: types.FinancialHealthDataSufficiency{
			Completeness: types.FinancialHealthInsufficient,
			Sources:      []types.FinancialHealthAccountSource{},
			Freshness: types.FinancialHealthFreshness{
				AsOfDate:             report.AsOfDate,
				StaleAfterDays:       options.StaleAfterDays,
				StaleAccountIDs:      []string{},
				UnobservedAccountIDs: []string{},
			},
			Coverage: types.FinancialHealthCoverage{
				ExcludedIDs:                []string{},
				UnknownLiabilityAccountIDs: []string{},
				FlowSources:                map[string]int{},
			},
		},
		Actions: []types.FinancialHealthProposedAction{{
			ID:       "record-baseline",
			Title:    "Record balances and activity",
			Detail:   "There is no usable saved state at the as-of cut. Add account balances and recorded income and spending before any assessment can be made.",
			CheckIDs: []string{},
			Evidence: []types.FinancialHealthEvidenceItem{},
			Targets:  map[string]float64{"lookbackDays": lookback},
		}},
	}
}

// finExplainFlowSources counts window flow postings by author. Membership
// mirrors the FIN-03 window (enabled, settled, external flows dated inside
// it); only the authorship split is new, so totals stay consistent with
// the report's flow coverage. Owner rows, including rows from before
// authorship was assigned, group as "manual".
func finExplainFlowSources(model *types.FinancialModel, report types.FinancialHealthReport) map[string]int {
	flowSources := map[string]int{}
	if model == nil || report.WindowStart == "" || report.WindowEnd == "" {
		return flowSources
	}
	for index := range model.Postings {
		posting := &model.Postings[index]
		if !posting.Enabled || posting.Pending || posting.Void {
			continue
		}
		day := postingDay(posting)
		if day == "" || CompareIsoDates(day, report.WindowStart) < 0 || CompareIsoDates(day, report.WindowEnd) > 0 {
			continue
		}
		if !IsExternalInflow(posting) && !IsExternalOutflow(posting) {
			continue
		}
		author := posting.Source
		if !IsSyncCheckpoint(author) {
			author = types.FinancialHealthOriginManual
		}
		flowSources[author]++
	}
	return flowSources
}

// finExplainActions proposes gap-closing actions first, then one
// improvement action per at-risk or not-meeting check. Every action links
// to the evidence behind it and to the user-configurable targets it
// moves; insufficient-data and meeting checks never produce improvement
// actions.
func finExplainActions(model *types.FinancialModel, report types.FinancialHealthReport, options types.FinancialHealthExplanationOptions, sources []types.FinancialHealthAccountSource, coverage types.FinancialHealthCoverage, freshness types.FinancialHealthFreshness) []types.FinancialHealthProposedAction {
	actions := []types.FinancialHealthProposedAction{}
	lookback := float64(report.Standards.LookbackDays)
	if lookback < 1 {
		lookback = float64(types.DefaultFinancialHealthStandards().LookbackDays)
	}
	names := map[string]string{}
	for _, account := range model.Accounts {
		names[account.ID] = account.Name
	}
	accountName := func(id string) string {
		if name, ok := names[id]; ok && name != "" {
			return name
		}
		return id
	}

	if coverage.MissingIncome {
		evidence := []types.FinancialHealthEvidenceItem{}
		for _, checkID := range []string{types.FinancialHealthCheckCashFlowSustainability, types.FinancialHealthCheckSavingsRate} {
			if check := finExplainCheckByID(report, checkID); check != nil {
				evidence = append(evidence, finExplainCopyEvidence(check.Evidence)...)
			}
		}
		actions = append(actions, types.FinancialHealthProposedAction{
			ID:       "record-missing-income",
			Title:    "Record income in the window",
			Detail:   fmt.Sprintf("No income is recorded in the %.0f days ending %s, so income-based checks cannot be trusted. Add the missing pay or inflow records.", lookback, report.WindowEnd),
			CheckIDs: []string{types.FinancialHealthCheckCashFlowSustainability, types.FinancialHealthCheckSavingsRate},
			Evidence: evidence,
			Targets:  map[string]float64{"lookbackDays": lookback},
		})
	}
	if len(coverage.UnknownLiabilityAccountIDs) > 0 {
		labeled := make([]string, 0, len(coverage.UnknownLiabilityAccountIDs))
		for _, id := range coverage.UnknownLiabilityAccountIDs {
			labeled = append(labeled, accountName(id))
		}
		debtCheck := finExplainCheckByID(report, types.FinancialHealthCheckDebtBurden)
		evidence := []types.FinancialHealthEvidenceItem{}
		targets := map[string]float64{}
		if debtCheck != nil {
			evidence = finExplainCopyEvidence(debtCheck.Evidence)
			targets = finExplainCopyTargets(debtCheck.Threshold)
		}
		actions = append(actions, types.FinancialHealthProposedAction{
			ID:       "clarify-liabilities",
			Title:    "Add payment terms for debt accounts",
			Detail:   fmt.Sprintf("Required minimums are unknown for %s: without payment terms the debt-burden check cannot weigh them against income.", strings.Join(labeled, ", ")),
			CheckIDs: []string{types.FinancialHealthCheckDebtBurden, types.FinancialHealthCheckHighInterestDebt},
			Evidence: evidence,
			Targets:  targets,
		})
	}
	if len(freshness.StaleAccountIDs) > 0 {
		evidence := make([]types.FinancialHealthEvidenceItem, 0, len(freshness.StaleAccountIDs))
		labeled := make([]string, 0, len(freshness.StaleAccountIDs))
		for _, row := range sources {
			if !row.Stale || row.AgeDays == nil {
				continue
			}
			labeled = append(labeled, fmt.Sprintf("%s (%.1f days old)", accountName(row.AccountID), *row.AgeDays))
			evidence = append(evidence, types.FinancialHealthEvidenceItem{
				Label:      accountName(row.AccountID),
				Detail:     fmt.Sprintf("Last balance observation is %.1f days before the cut, past the %d-day recency guideline.", *row.AgeDays, options.StaleAfterDays),
				AccountIDs: []string{row.AccountID},
			})
		}
		actions = append(actions, types.FinancialHealthProposedAction{
			ID:       "refresh-stale-sync",
			Title:    "Refresh stale balances",
			Detail:   fmt.Sprintf("Balance checks read observations past the %d-day recency guideline: %s. Re-run sync or add fresh balance observations.", options.StaleAfterDays, strings.Join(labeled, ", ")),
			CheckIDs: append([]string(nil), finExplainBalanceChecks...),
			Evidence: evidence,
			Targets:  map[string]float64{"staleAfterDays": float64(options.StaleAfterDays)},
		})
	}
	if len(freshness.UnobservedAccountIDs) > 0 {
		evidence := make([]types.FinancialHealthEvidenceItem, 0, len(freshness.UnobservedAccountIDs))
		labeled := make([]string, 0, len(freshness.UnobservedAccountIDs))
		for _, id := range freshness.UnobservedAccountIDs {
			labeled = append(labeled, accountName(id))
			evidence = append(evidence, types.FinancialHealthEvidenceItem{
				Label:      accountName(id),
				Detail:     "No balance observation at or before the cut, so balance checks cannot see this account.",
				AccountIDs: []string{id},
			})
		}
		actions = append(actions, types.FinancialHealthProposedAction{
			ID:       "observe-accounts",
			Title:    "Add balance observations for unseen accounts",
			Detail:   fmt.Sprintf("These accounts have no observation at the cut and are invisible to balance checks: %s. Add a balance observation dated at or before the cut.", strings.Join(labeled, ", ")),
			CheckIDs: append([]string(nil), finExplainBalanceChecks...),
			Evidence: evidence,
			Targets:  map[string]float64{"staleAfterDays": float64(options.StaleAfterDays)},
		})
	}
	if coverage.ExcludedPostings > 0 {
		evidence := []types.FinancialHealthEvidenceItem{}
		if check := finExplainCheckByID(report, types.FinancialHealthCheckCashFlowSustainability); check != nil {
			evidence = finExplainCopyEvidence(check.Evidence)
		}
		if len(evidence) == 0 {
			evidence = []types.FinancialHealthEvidenceItem{{
				Label:      "Unresolvable amounts",
				Detail:     "Window postings whose amounts need replay-time state or simulation context and are excluded from both totals.",
				PostingIDs: append([]string(nil), coverage.ExcludedIDs...),
			}}
		}
		actions = append(actions, types.FinancialHealthProposedAction{
			ID:       "resolve-excluded-amounts",
			Title:    "Resolve excluded window amounts",
			Detail:   fmt.Sprintf("%d window posting(s) need replay-time state or simulation context and are excluded from income and spending totals. Replace them with recorded amounts or accept the gap.", coverage.ExcludedPostings),
			CheckIDs: []string{types.FinancialHealthCheckCashFlowSustainability, types.FinancialHealthCheckSavingsRate, types.FinancialHealthCheckSpendingConsistency},
			Evidence: evidence,
			Targets:  map[string]float64{"lookbackDays": lookback},
		})
	}
	for _, checkID := range types.FinancialHealthCheckOrder {
		check := finExplainCheckByID(report, checkID)
		if check == nil || (check.Status != types.FinancialHealthAtRisk && check.Status != types.FinancialHealthNotMeeting) {
			continue
		}
		label, ok := finExplainCheckLabels[checkID]
		if !ok {
			label = checkID
		}
		targets := finExplainCopyTargets(check.Threshold)
		detail := check.Summary
		if len(targets) > 0 {
			pairs := make([]string, 0, len(targets))
			for key, value := range targets {
				pairs = append(pairs, fmt.Sprintf("%s %g", key, value))
			}
			detail = fmt.Sprintf("%s The applied guideline is %s; adjust it openly if the household's situation differs.", detail, strings.Join(pairs, ", "))
		}
		actions = append(actions, types.FinancialHealthProposedAction{
			ID:       "improve-" + checkID,
			Title:    fmt.Sprintf("Move %s toward its guideline", label),
			Detail:   detail,
			CheckIDs: []string{checkID},
			Evidence: finExplainCopyEvidence(check.Evidence),
			Targets:  targets,
		})
	}
	return actions
}
