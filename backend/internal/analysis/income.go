package analysis

import (
	"context"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const IncomeVersion = "income-v1"

// Income detects recurring external inflows and ranks the main consistent
// inflow so the user does not have to name it. It is a pure Go deterministic
// pattern gate with an optional domain judgment. How that judgment is produced
// is owned entirely by the injected evaluator.
type Income struct {
	Judge          judgment.Evaluator
	version        string
	preparationErr error
}

func (Income) Type() string { return "income" }
func (in Income) Version() string {
	if in.version != "" {
		return in.version
	}
	return IncomeVersion
}

func (Income) MatchesVersion(version string) bool {
	return version == IncomeVersion || strings.HasPrefix(version, IncomeVersion+"/")
}

// payrollDescriptor matched against description, payee, memo, merchant.
var payrollDescriptor = regexp.MustCompile(`(?i)\b(payroll|salary|paycheck|direct[ _-]*deposit|dir[ _-]*dep|ach[ _-]*credit|paystub|paystub|pension|ssa|va[ _-]*benefits|social[ _-]*security)\b`)

// incomeRefundMarker excludes refunds, reversals and returns which are not income.
var incomeRefundMarker = regexp.MustCompile(`(?i)\b(refund|reversal|chargeback|return)\b`)

// incomeCadences annualize the median amount.
var incomeCadences = []struct {
	id     string
	days   float64
	minOcc int
	factor float64
}{
	{"weekly", 7, 3, 52},
	{"biweekly", 14, 3, 26},
	{"monthly", 30.4375, 3, 12},
	{"quarterly", 91.3125, 3, 4},
	{"annual", 365.25, 2, 1},
}

type incomeCandidate struct {
	transaction types.AnalysisTransaction
	amount      float64
	day         int64
	text        string
}

type incomePattern struct {
	patternID      string
	merchant       string
	cadence        string
	cadenceDays    float64
	annualFactor   float64
	typical        float64
	annualized     float64
	amountCV       float64
	gapCV          float64
	medianGap      float64
	occurrences    []incomeCandidate
	descriptorHit  bool
	categoryIncome bool
	currency       string
	recencyDays    float64
	judgment       *types.AnalysisJudgment
	isMain         bool
}

func incomeMedian(values []float64) float64 {
	return recurringMedian(values)
}

func incomeMean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func incomeStd(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	mean := incomeMean(values)
	sum := 0.0
	for _, v := range values {
		d := v - mean
		sum += d * d
	}
	return math.Sqrt(sum / float64(len(values)))
}

func incomeCV(values []float64) float64 {
	mean := incomeMean(values)
	if mean == 0 {
		return 0
	}
	return incomeStd(values) / mean
}

func incomeStamp(facts types.TransactionFacts) int64 {
	if facts.OccurredAt > 0 {
		return facts.OccurredAt
	}
	return facts.PostedTime
}

func (in Income) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	findings := []types.AnalysisDetection{}
	transferIDs, err := incomeTransferIDs(ctx, input.Transactions)
	if err != nil {
		return nil, err
	}

	// Track latest day for recency.
	var latestDay int64
	for _, tx := range input.Transactions {
		if tx.Pending || tx.Void {
			continue
		}
		stamp := incomeStamp(tx.Facts)
		if stamp > 0 {
			if d := stamp / 86400; d > latestDay {
				latestDay = d
			}
		}
	}

	groups := map[string][]incomeCandidate{}
	for _, tx := range input.Transactions {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if tx.Pending || tx.Void {
			continue
		}
		if transferIDs[tx.TransactionID] {
			continue
		}
		facts := tx.Facts
		text := strings.Join([]string{facts.Description, facts.Payee, facts.Memo, facts.Metadata["merchant_name"]}, " ")
		if incomeRefundMarker.MatchString(text) {
			continue
		}
		merchant := recurringKey(text)
		if merchant == "" {
			continue
		}
		amount, err := strconv.ParseFloat(facts.Amount, 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || amount > 1e10 {
			continue // income is positive inflow only
		}
		stamp := incomeStamp(facts)
		if stamp <= 0 {
			continue
		}
		key := strings.Join([]string{tx.SourceProvider, tx.AccountID, facts.Currency, "inflow", merchant}, "\x00")
		groups[key] = append(groups[key], incomeCandidate{tx, amount, stamp / 86400, text})
	}

	var patterns []*incomePattern
	// To keep determinism, iterate keys sorted.
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		group := groups[key]

		amounts := make([]float64, 0, len(group))
		for _, item := range group {
			amounts = append(amounts, math.Abs(item.amount))
		}
		typical := incomeMedian(amounts)
		if typical <= 0 {
			continue
		}
		// Amount outlier filter like recurring (15%).
		kept := make([]incomeCandidate, 0, len(group))
		for _, item := range group {
			if math.Abs(math.Abs(item.amount)-typical) <= recurringTolerance*typical {
				kept = append(kept, item)
			}
		}
		if len(kept) < 2 {
			continue
		}
		sort.Slice(kept, func(i, j int) bool { return kept[i].day < kept[j].day })
		gaps := make([]float64, 0, len(kept)-1)
		for i := 1; i < len(kept); i++ {
			gaps = append(gaps, float64(kept[i].day-kept[i-1].day))
		}
		medianGap := incomeMedian(gaps)
		if medianGap <= 0 {
			continue
		}
		cadence := ""
		cadenceMeta := struct {
			id     string
			days   float64
			minOcc int
			factor float64
		}{}
		for _, opt := range incomeCadences {
			if math.Abs(medianGap-opt.days) <= recurringTolerance*opt.days {
				cadence = opt.id
				cadenceMeta = opt
				break
			}
		}
		if cadence == "" || len(kept) < cadenceMeta.minOcc {
			continue
		}
		regular := true
		for _, gap := range gaps {
			regular = regular && math.Abs(gap-medianGap) <= recurringTolerance*medianGap
		}
		if !regular {
			continue
		}
		merchant := strings.Split(key, "\x00")[4]
		currency := kept[0].transaction.Facts.Currency
		amountVals := make([]float64, 0, len(kept))
		for _, item := range kept {
			amountVals = append(amountVals, item.amount)
		}
		annualized := typical * cadenceMeta.factor

		descriptorHit := false
		categoryIncome := false
		for _, item := range kept {
			if payrollDescriptor.MatchString(item.text) {
				descriptorHit = true
			}
			if cat, ok := types.BankCategory(item.transaction.Facts.Metadata["category"]); ok && cat == types.CategoryIncome {
				categoryIncome = true
			}
		}
		var recency float64
		if latestDay > 0 {
			recency = float64(latestDay - kept[len(kept)-1].day)
		}
		patterns = append(patterns, &incomePattern{
			patternID:      incomePatternID(input.UserID, key, cadence),
			merchant:       merchant,
			cadence:        cadence,
			cadenceDays:    cadenceMeta.days,
			annualFactor:   cadenceMeta.factor,
			typical:        typical,
			annualized:     annualized,
			amountCV:       incomeCV(amountVals),
			gapCV:          incomeCV(gaps),
			medianGap:      medianGap,
			occurrences:    kept,
			descriptorHit:  descriptorHit,
			categoryIncome: categoryIncome,
			currency:       currency,
			recencyDays:    recency,
		})
	}

	if len(patterns) == 0 {
		return findings, nil
	}

	judgmentErr := in.preparationErr
	if in.Judge != nil {
		judgmentErr = judgeIncome(ctx, in.Judge, patterns)
	} else if judgmentErr != nil {
		for _, pat := range patterns {
			pat.judgment = &types.AnalysisJudgment{RequestID: pat.judgmentInput().ID, Status: "unavailable"}
		}
	}

	// Rank: top annualized is main consistent inflow.
	sort.Slice(patterns, func(i, j int) bool {
		if patterns[i].annualized != patterns[j].annualized {
			return patterns[i].annualized > patterns[j].annualized
		}
		if patterns[i].merchant != patterns[j].merchant {
			return patterns[i].merchant < patterns[j].merchant
		}
		return patterns[i].patternID < patterns[j].patternID
	})
	comparable := patterns[0].currency != ""
	for _, pat := range patterns {
		comparable = comparable && pat.currency == patterns[0].currency
	}
	if comparable {
		patterns[0].isMain = true
	}

	for _, pat := range patterns {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		findings = append(findings, pat.findings()...)
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].TransactionID < findings[j].TransactionID })
	return findings, judgmentErr
}
