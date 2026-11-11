package analysis

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// IncrementalPaymentOutcome is the result of one incremental payment-stream
// pass. Findings is the full reconciled set: fresh detections for recomputed
// streams plus carried-forward detections for the rest. RecomputedStreamIDs
// names every stream whose findings were recomputed or vanished, so the
// publisher reconciles and withdraws exactly those rows. UpdatedStreams and
// DeletedStreamIDs refresh the durable stream cache.
type IncrementalPaymentOutcome struct {
	Findings            []types.AnalysisDetection
	RecomputedStreamIDs []string
	UpdatedStreams      []store.AnalysisPaymentStream
	DeletedStreamIDs    []string
	FullRebuild         bool
}

// AnalyzeIncrementalPayments recomputes only streams touched by dirty facts
// since the cache's consumed revision. Dirty facts assign to streams with the
// existing stream-identity logic; a fact whose identity moved recomputes both
// its old and new stream, and both sides of any touched opposite-leg transfer
// pair recompute. Only affected streams are judged; prior judgments are reused
// by request-identity hash, and untouched streams keep their findings
// byte-identical. An empty cache, an identity-version mismatch, or a removed
// classification means one full rebuild that repopulates the cache instead.
// Recurring, transfer, and BNPL detectors keep full recompute and are untouched.
func AnalyzeIncrementalPayments(ctx context.Context, definitions []PaymentClassification, judge judgment.Evaluator, preparationErr error, input types.AnalysisSnapshot, dirty []store.AnalysisDirtyFact, cached []store.AnalysisPaymentStream, prior []types.AnalysisDetection) (IncrementalPaymentOutcome, error) {
	if definitions == nil {
		definitions = PaymentClassifications()
	}
	if err := validatePaymentClassifications(definitions); err != nil {
		return IncrementalPaymentOutcome{}, err
	}
	priorJudgments := indexPriorJudgments(prior)
	if needsPaymentRebuild(definitions, cached, prior) {
		return rebuildPaymentStreams(ctx, definitions, judge, preparationErr, input, cached, priorJudgments)
	}
	return updatePaymentStreams(ctx, definitions, judge, preparationErr, input, dirty, cached, prior, priorJudgments)
}

// needsPaymentRebuild reports whether the durable cache is unusable: no cache
// yet, stream identity logic moved on, or a classification the prior findings
// reference no longer exists (its findings must be withdrawn by a full pass).
func needsPaymentRebuild(definitions []PaymentClassification, cached []store.AnalysisPaymentStream, prior []types.AnalysisDetection) bool {
	if len(cached) == 0 {
		return true
	}
	for _, entry := range cached {
		if entry.IdentityVersion != PaymentStreamIdentityVersion {
			return true
		}
	}
	known := map[string]bool{}
	for _, definition := range definitions {
		known[definition.ID] = true
	}
	for _, finding := range prior {
		if !known[finding.Kind] {
			return true
		}
	}
	return false
}

func indexPriorJudgments(prior []types.AnalysisDetection) map[string]types.AnalysisJudgment {
	out := map[string]types.AnalysisJudgment{}
	for _, finding := range prior {
		if finding.JudgmentInput == nil || finding.Judgment == nil {
			continue
		}
		// Only ready judgments reuse: pending and unavailable are retryable
		// states, so their streams rejoin the pass and refresh without bank
		// changes.
		if finding.Judgment.Status != "ready" {
			continue
		}
		if _, seen := out[finding.JudgmentInput.ID]; !seen {
			out[finding.JudgmentInput.ID] = *finding.Judgment
		}
	}
	return out
}

func rebuildPaymentStreams(ctx context.Context, definitions []PaymentClassification, judge judgment.Evaluator, preparationErr error, input types.AnalysisSnapshot, cached []store.AnalysisPaymentStream, priorJudgments map[string]types.AnalysisJudgment) (IncrementalPaymentOutcome, error) {
	streams, err := detectPaymentStreams(ctx, input)
	if err != nil {
		return IncrementalPaymentOutcome{}, err
	}
	patterns := classifyPaymentStreams(definitions, streams)
	judgmentErr := judgeSelectedPayments(ctx, judge, preparationErr, patterns, priorJudgments)
	assignPaymentMain(patterns)
	findings, err := paymentPatternFindings(ctx, patterns)
	if err != nil {
		return IncrementalPaymentOutcome{}, err
	}
	current := map[string]bool{}
	updated := make([]store.AnalysisPaymentStream, 0, len(streams))
	for _, stream := range streams {
		current[stream.streamID] = true
		updated = append(updated, cachePaymentStream(stream, input.Revision))
	}
	sort.Slice(updated, func(i, j int) bool { return updated[i].StreamID < updated[j].StreamID })
	outcome := IncrementalPaymentOutcome{Findings: findings, UpdatedStreams: updated, FullRebuild: true}
	for _, entry := range cached {
		if !current[entry.StreamID] {
			outcome.DeletedStreamIDs = append(outcome.DeletedStreamIDs, entry.StreamID)
		}
	}
	sort.Strings(outcome.DeletedStreamIDs)
	for streamID := range current {
		outcome.RecomputedStreamIDs = append(outcome.RecomputedStreamIDs, streamID)
	}
	outcome.RecomputedStreamIDs = append(outcome.RecomputedStreamIDs, outcome.DeletedStreamIDs...)
	sort.Strings(outcome.RecomputedStreamIDs)
	if judgmentErr == nil {
		judgmentErr = incrementalJudgmentError(judge, preparationErr, findings)
	}
	return outcome, judgmentErr
}

func updatePaymentStreams(ctx context.Context, definitions []PaymentClassification, judge judgment.Evaluator, preparationErr error, input types.AnalysisSnapshot, dirty []store.AnalysisDirtyFact, cached []store.AnalysisPaymentStream, prior []types.AnalysisDetection, priorJudgments map[string]types.AnalysisJudgment) (IncrementalPaymentOutcome, error) {
	since := cached[0].ConsumedRevision
	for _, entry := range cached[1:] {
		since = min(since, entry.ConsumedRevision)
	}
	oldAssign := map[string]string{}
	cachedLegs := map[string]incrementalTransferLeg{}
	for _, entry := range cached {
		for _, id := range entry.MemberTransactionIDs {
			oldAssign[id] = entry.StreamID
		}
		for id, leg := range parseIncrementalStreamLegs(entry.StatsJSON) {
			cachedLegs[id] = leg
		}
	}
	byID := map[string]types.AnalysisTransaction{}
	for _, tx := range input.Transactions {
		if err := ctx.Err(); err != nil {
			return IncrementalPaymentOutcome{}, err
		}
		byID[tx.TransactionID] = tx
	}
	groups, err := paymentGroups(ctx, input.Transactions)
	if err != nil {
		return IncrementalPaymentOutcome{}, err
	}
	newAssign := map[string]string{}
	groupByStream := map[string]paymentGroup{}
	current := map[string]bool{}
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			return IncrementalPaymentOutcome{}, err
		}
		streamID := paymentPatternID(input.UserID, group.key, "")
		groupByStream[streamID] = group
		current[streamID] = true
		for _, item := range group.candidates {
			newAssign[item.transaction.TransactionID] = streamID
		}
	}
	pairs, err := paymentTransferPairs(ctx, input.Transactions)
	if err != nil {
		return IncrementalPaymentOutcome{}, err
	}
	affected := map[string]bool{}
	for _, fact := range dirty {
		if err := ctx.Err(); err != nil {
			return IncrementalPaymentOutcome{}, err
		}
		if fact.Revision <= since {
			continue
		}
		if streamID := newAssign[fact.TransactionID]; streamID != "" {
			affected[streamID] = true
		}
		if streamID := oldAssign[fact.TransactionID]; streamID != "" {
			affected[streamID] = true
		}
		// Opposite-leg coupling: a new leg changes exclusion in the stream
		// holding the other leg, so recompute both sides of the pair. Live
		// pairs cover current legs; cached legs also cover partners a
		// changed fact used to pair with.
		for partner := range pairs[fact.TransactionID] {
			if streamID := newAssign[partner]; streamID != "" {
				affected[streamID] = true
			}
		}
		if leg, ok := cachedLegs[fact.TransactionID]; ok {
			for _, tx := range input.Transactions {
				if tx.Pending || tx.Void || tx.Facts.Currency != "USD" {
					continue
				}
				cents, day, outflow, ok := paymentLegKeyFacts(tx.Facts)
				if !ok || cents != leg.Cents || outflow == leg.Outflow || tx.AccountID == leg.Account {
					continue
				}
				if day < leg.Day-7 || day > leg.Day+7 {
					continue
				}
				if streamID := newAssign[tx.TransactionID]; streamID != "" {
					affected[streamID] = true
				}
			}
		}
	}
	// Vanished streams always recompute so their stale findings withdraw.
	var vanished []string
	for _, entry := range cached {
		if !current[entry.StreamID] {
			vanished = append(vanished, entry.StreamID)
			affected[entry.StreamID] = true
		}
	}
	// Streams with non-ready carried judgments rejoin the pass so late
	// provider decisions refresh without bank changes. Ready judgments reuse
	// by request identity and never call the provider again.
	for _, finding := range prior {
		if finding.StreamID == "" || affected[finding.StreamID] || !current[finding.StreamID] {
			continue
		}
		if finding.Judgment == nil || finding.Judgment.Status != "ready" {
			affected[finding.StreamID] = true
		}
	}
	if len(affected) == 0 {
		findings := append([]types.AnalysisDetection{}, prior...)
		sortPaymentFindings(findings)
		return IncrementalPaymentOutcome{Findings: findings}, incrementalJudgmentError(judge, preparationErr, findings)
	}
	matched := map[string]bool{}
	for id := range pairs {
		matched[id] = true
	}
	latest := latestPaymentDay(input.Transactions)
	streams := make([]*paymentStream, 0, len(affected))
	for streamID := range affected {
		if err := ctx.Err(); err != nil {
			return IncrementalPaymentOutcome{}, err
		}
		group, ok := groupByStream[streamID]
		if !ok {
			continue
		}
		streams = append(streams, observePaymentStream(input.UserID, group, group.candidates, matched, latest))
	}
	patterns := classifyPaymentStreams(definitions, streams)
	judgeErr := judgeSelectedPayments(ctx, judge, preparationErr, patterns, priorJudgments)
	findings, err := rankIncrementalPayments(ctx, definitions, patterns, prior, affected)
	if err != nil {
		return IncrementalPaymentOutcome{}, err
	}
	outcome := IncrementalPaymentOutcome{Findings: findings, DeletedStreamIDs: vanished}
	for _, stream := range streams {
		outcome.UpdatedStreams = append(outcome.UpdatedStreams, cachePaymentStream(stream, input.Revision))
	}
	sort.Slice(outcome.UpdatedStreams, func(i, j int) bool { return outcome.UpdatedStreams[i].StreamID < outcome.UpdatedStreams[j].StreamID })
	sort.Strings(outcome.DeletedStreamIDs)
	for streamID := range affected {
		outcome.RecomputedStreamIDs = append(outcome.RecomputedStreamIDs, streamID)
	}
	sort.Strings(outcome.RecomputedStreamIDs)
	if judgeErr == nil {
		judgeErr = incrementalJudgmentError(judge, preparationErr, findings)
	} else if judge != nil {
		// The subset assess already failed; a carried unavailable still wins,
		// matching full-recompute precedence.
		if scanPaymentJudgments(findings) == judgment.ErrUnavailable {
			judgeErr = judgment.ErrUnavailable
		}
	}
	return outcome, judgeErr
}

// judgeSelectedPayments judges affected candidates only. Requests whose
// identity hash matches a prior judgment reuse it without calling the
// provider, so provider work scales with changed streams, not total streams.
// Batching and deferred-error precedence match judgePayments.
func judgeSelectedPayments(ctx context.Context, evaluator judgment.Evaluator, preparationErr error, patterns []*classifiedPayment, prior map[string]types.AnalysisJudgment) error {
	requests := map[string]*types.AnalysisJudgmentInput{}
	var order []string
	indexes := map[string][]int{}
	for i, pat := range patterns {
		request := pat.judgmentInput()
		if reused, ok := prior[request.ID]; ok {
			dupe := reused
			pat.judgment = &dupe
			continue
		}
		if _, seen := requests[request.ID]; !seen {
			requests[request.ID] = request
			order = append(order, request.ID)
		}
		indexes[request.ID] = append(indexes[request.ID], i)
	}
	if len(order) == 0 {
		if evaluator == nil {
			return preparationErr
		}
		return nil
	}
	if evaluator == nil {
		if preparationErr != nil {
			for _, id := range order {
				for _, i := range indexes[id] {
					patterns[i].judgment = &types.AnalysisJudgment{RequestID: id, Status: "unavailable"}
				}
			}
		}
		return preparationErr
	}
	ordered := make([]types.AnalysisJudgmentInput, 0, len(order))
	for _, id := range order {
		ordered = append(ordered, *requests[id])
	}
	var deferred error
	for start := 0; start < len(ordered); start += 100 {
		end := min(start+100, len(ordered))
		decisions, err := judgment.Assess(ctx, evaluator, ordered[start:end])
		if err != nil && (deferred == nil || err == judgment.ErrUnavailable) {
			deferred = err
		}
		for i := range decisions {
			for _, pi := range indexes[ordered[start+i].ID] {
				dupe := decisions[i]
				patterns[pi].judgment = &dupe
			}
		}
	}
	return deferred
}

// rankIncrementalPayments resolves main-inflow ranking over fresh candidates
// plus cached per-stream annualized values from prior findings, with no
// re-detection of untouched streams. Fresh findings render normally;
// carried-forward findings are reused verbatim except for a main-inflow
// promotion or demotion patch.
func rankIncrementalPayments(ctx context.Context, definitions []PaymentClassification, patterns []*classifiedPayment, prior []types.AnalysisDetection, affected map[string]bool) ([]types.AnalysisDetection, error) {
	byID := map[string]PaymentClassification{}
	for _, definition := range definitions {
		byID[definition.ID] = definition
	}
	type entry struct {
		annualized                            float64
		merchant, patternID, classificationID string
		currency, cadence, decision           string
		rankMain                              bool
		fresh                                 *classifiedPayment
		carried                               []int
	}
	var entries []*entry
	for _, pat := range patterns {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entries = append(entries, &entry{
			annualized: pat.annualized, merchant: pat.merchant, patternID: pat.patternID,
			classificationID: pat.classification.ID, currency: pat.currency, cadence: pat.cadence,
			decision: pat.decision(), rankMain: pat.classification.RankMain, fresh: pat,
		})
	}
	carried := make([]types.AnalysisDetection, 0, len(prior))
	byKey := map[string]*entry{}
	for _, finding := range prior {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if affected[finding.StreamID] {
			continue
		}
		definition, ok := byID[finding.Kind]
		if !ok {
			continue
		}
		patternID := ""
		currency := ""
		var signals []string
		decision := ""
		if finding.Pattern != nil {
			patternID = finding.Pattern.PatternID
			currency = finding.Pattern.Currency
		}
		if finding.Judgment != nil && finding.Judgment.Status == "ready" {
			decision = finding.Judgment.Decision
		} else {
			if finding.JudgmentInput != nil {
				signals = finding.JudgmentInput.Pattern.Signals
			}
			decision = deterministicPaymentDecision(definition, signals)
		}
		annualized := 0.0
		if finding.Pattern != nil && finding.Pattern.AnnualizedEstimate != "" {
			if value, err := strconv.ParseFloat(finding.Pattern.AnnualizedEstimate, 64); err == nil {
				annualized = value
			}
		}
		key := strings.Join([]string{finding.StreamID, finding.Kind, patternID}, "\x00")
		group, ok := byKey[key]
		if !ok {
			group = &entry{
				annualized: annualized, merchant: finding.Provider, patternID: patternID,
				classificationID: finding.Kind, currency: currency, cadence: finding.Product,
				decision: decision, rankMain: definition.RankMain,
			}
			byKey[key] = group
			entries = append(entries, group)
		}
		group.carried = append(group.carried, len(carried))
		carried = append(carried, finding)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].annualized != entries[j].annualized {
			return entries[i].annualized > entries[j].annualized
		}
		if entries[i].merchant != entries[j].merchant {
			return entries[i].merchant < entries[j].merchant
		}
		if entries[i].patternID != entries[j].patternID {
			return entries[i].patternID < entries[j].patternID
		}
		return entries[i].classificationID < entries[j].classificationID
	})
	ranked := map[string][]*entry{}
	for _, candidate := range entries {
		if candidate.rankMain && candidate.cadence != "" && candidate.decision != "unsupported" {
			ranked[candidate.classificationID] = append(ranked[candidate.classificationID], candidate)
		}
	}
	winners := map[int]bool{}
	for _, group := range ranked {
		comparable := group[0].currency != ""
		for _, candidate := range group {
			comparable = comparable && candidate.currency == group[0].currency
		}
		if !comparable {
			continue
		}
		if group[0].fresh != nil {
			group[0].fresh.isMain = true
		}
		for _, index := range group[0].carried {
			winners[index] = true
		}
	}
	// Only a comparable-group winner keeps the mark; every other carried
	// candidate falls back to its direction code, including members of
	// groups that turned incomparable.
	for i := range carried {
		if len(carried[i].Evidence) == 0 || carried[i].Product == "" {
			continue
		}
		applyPaymentMain(&carried[i], winners[i])
	}
	findings := []types.AnalysisDetection{}
	for _, pat := range patterns {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		findings = append(findings, pat.findings()...)
	}
	findings = append(findings, carried...)
	sortPaymentFindings(findings)
	return findings, nil
}

// applyPaymentMain flips a carried-forward finding between its direction
// code and the main-inflow code, adding or removing the main sentence. Only
// the rank mark moves; every other byte stays identical.
func applyPaymentMain(finding *types.AnalysisDetection, main bool) {
	if len(finding.Evidence) == 0 || finding.Product == "" {
		return
	}
	const sentence = " This is the main consistent inflow."
	const marker = " Assessment of "
	mainCode := finding.Kind + ".main-inflow:annualized"
	sideCode := finding.Kind + "." + finding.Role + ":annualized"
	if main {
		finding.Evidence[0].Code = mainCode
		if strings.Contains(finding.Evidence[0].Reason, sentence) {
			return
		}
		if i := strings.Index(finding.Evidence[0].Reason, marker); i >= 0 {
			finding.Evidence[0].Reason = finding.Evidence[0].Reason[:i] + sentence + finding.Evidence[0].Reason[i:]
		} else {
			finding.Evidence[0].Reason += sentence
		}
		return
	}
	finding.Evidence[0].Code = sideCode
	finding.Evidence[0].Reason = strings.ReplaceAll(finding.Evidence[0].Reason, sentence, "")
}

func sortPaymentFindings(findings []types.AnalysisDetection) {
	sort.Slice(findings, func(i, j int) bool {
		if findings[i].TransactionID != findings[j].TransactionID {
			return findings[i].TransactionID < findings[j].TransactionID
		}
		return findings[i].Kind < findings[j].Kind
	})
}

// scanPaymentJudgments reports the dominant judgment status across final
// findings, with unavailable winning over pending like judgment.Assess.
func scanPaymentJudgments(findings []types.AnalysisDetection) error {
	pending := false
	for _, finding := range findings {
		if finding.Judgment == nil {
			continue
		}
		switch finding.Judgment.Status {
		case "unavailable":
			return judgment.ErrUnavailable
		case "pending":
			pending = true
		}
	}
	if pending {
		return judgment.ErrPending
	}
	return nil
}

// incrementalJudgmentError mirrors full-recompute judgment problems without
// re-requesting carried-forward judgments: with no evaluator the preparation
// error stands, otherwise the dominant final judgment status decides.
func incrementalJudgmentError(evaluator judgment.Evaluator, preparationErr error, findings []types.AnalysisDetection) error {
	if evaluator == nil {
		return preparationErr
	}
	return scanPaymentJudgments(findings)
}

// incrementalTransferLeg is the durable opposite-leg matching key for one
// member transaction, so a deleted leg still names the partners it paired
// with. Fields mirror paymentLegKeyFacts exactly.
type incrementalTransferLeg struct {
	Cents   int64  `json:"cents"`
	Day     int64  `json:"day"`
	Account string `json:"account"`
	Outflow bool   `json:"outflow"`
}

// incrementalStreamStats is the opaque per-stream statistics payload. Members
// live in the cache column; legs support opposite-leg coupling for tombstones.
type incrementalStreamStats struct {
	Merchant  string                            `json:"merchant"`
	Direction string                            `json:"direction"`
	Currency  string                            `json:"currency"`
	Legs      map[string]incrementalTransferLeg `json:"legs,omitempty"`
}

func marshalIncrementalStreamStats(stream *paymentStream) string {
	stats := incrementalStreamStats{Merchant: stream.merchant, Direction: stream.direction, Currency: stream.currency}
	for _, item := range stream.occurrences {
		cents, day, outflow, ok := paymentLegKeyFacts(item.transaction.Facts)
		if !ok {
			continue
		}
		if stats.Legs == nil {
			stats.Legs = map[string]incrementalTransferLeg{}
		}
		stats.Legs[item.transaction.TransactionID] = incrementalTransferLeg{Cents: cents, Day: day, Account: item.transaction.AccountID, Outflow: outflow}
	}
	data, _ := json.Marshal(stats)
	return string(data)
}

func parseIncrementalStreamLegs(raw string) map[string]incrementalTransferLeg {
	var stats incrementalStreamStats
	if raw == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(raw), &stats); err != nil {
		return nil
	}
	return stats.Legs
}

func cachePaymentStream(stream *paymentStream, revision int64) store.AnalysisPaymentStream {
	members := make([]string, 0, len(stream.occurrences))
	for _, item := range stream.occurrences {
		members = append(members, item.transaction.TransactionID)
	}
	sort.Strings(members)
	return store.AnalysisPaymentStream{
		StreamID:             stream.streamID,
		StatsJSON:            marshalIncrementalStreamStats(stream),
		MemberTransactionIDs: members,
		ConsumedRevision:     revision,
		IdentityVersion:      PaymentStreamIdentityVersion,
	}
}

// paymentIncrementalDefinition is the prepared payments definition. Prepare
// snapshots the stream cache, dirty facts, and prior active findings; Analyze
// recomputes affected streams only; CompleteIncremental publishes per-stream.
type paymentIncrementalDefinition struct {
	base    PaymentPatterns
	scoped  store.AnalysisStore
	owner   string
	dirty   []store.AnalysisDirtyFact
	cached  []store.AnalysisPaymentStream
	prior   []types.AnalysisDetection
	outcome *IncrementalPaymentOutcome
}

func (d *paymentIncrementalDefinition) Type() string { return d.base.Type() }

func (d *paymentIncrementalDefinition) Version() string { return d.base.Version() }

func (d *paymentIncrementalDefinition) MatchesVersion(version string) bool {
	return d.base.MatchesVersion(version)
}

func (d *paymentIncrementalDefinition) Analyze(ctx context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	definitions := d.base.Classifications
	if definitions == nil {
		definitions = PaymentClassifications()
	}
	outcome, err := AnalyzeIncrementalPayments(ctx, definitions, d.base.Judge, d.base.preparationErr, input, d.dirty, d.cached, d.prior)
	d.outcome = &outcome
	return outcome.Findings, err
}

// CompleteIncremental publishes the stashed incremental outcome per-stream:
// recomputed findings reconcile with review preserved, withdrawal applies
// only within recomputed streams, and the stream cache advances. A hard
// analysis failure falls back to the standard completion path.
func (d *paymentIncrementalDefinition) CompleteIncremental(run types.AnalysisRun, problem string) error {
	if d.outcome == nil || problem == "analysis-failed" {
		return d.scoped.CompleteAnalysis(run, nil, problem)
	}
	publish := store.AnalysisPaymentPublish{
		Findings:            d.outcome.Findings,
		RecomputedStreamIDs: d.outcome.RecomputedStreamIDs,
		UpsertStreams:       d.outcome.UpdatedStreams,
		DeleteStreamIDs:     d.outcome.DeletedStreamIDs,
		Problem:             problem,
	}
	if publisher, ok := d.scoped.(interface {
		CompleteAnalysisPaymentStreams(types.AnalysisRun, store.AnalysisPaymentPublish) error
	}); ok {
		return publisher.CompleteAnalysisPaymentStreams(run, publish)
	}
	if err := d.scoped.CompleteAnalysis(run, publish.Findings, problem); err != nil {
		return err
	}
	for _, stream := range publish.UpsertStreams {
		if err := d.scoped.SaveAnalysisPaymentStream(stream); err != nil {
			return err
		}
	}
	for _, streamID := range publish.DeleteStreamIDs {
		if err := d.scoped.DeleteAnalysisPaymentStream(streamID); err != nil {
			return err
		}
	}
	return nil
}

// incrementalCacheCurrent reports whether the durable stream cache already
// consumed the current input revision. Two cheap reads replace the full
// findings pagination on idle ticks; any load failure means prepare fully.
func incrementalCacheCurrent(scoped store.AnalysisStore) bool {
	revision, err := scoped.AnalysisInputRevision()
	if err != nil {
		return false
	}
	cached, err := scoped.ListAnalysisPaymentStreams()
	if err != nil || len(cached) == 0 {
		return false
	}
	for _, entry := range cached {
		if entry.ConsumedRevision < revision {
			return false
		}
	}
	return true
}

// prepareIncremental loads the dirty set, stream cache, and prior active
// payments findings for one owner. Any load failure returns ok=false so the
// caller falls back to full recompute.
func prepareIncremental(scoped store.AnalysisStore) (dirty []store.AnalysisDirtyFact, cached []store.AnalysisPaymentStream, prior []types.AnalysisDetection, ok bool) {
	loadedCache, err := scoped.ListAnalysisPaymentStreams()
	if err != nil {
		return nil, nil, nil, false
	}
	loadedPrior, err := listActivePaymentDetections(scoped)
	if err != nil {
		return nil, nil, nil, false
	}
	var loadedDirty []store.AnalysisDirtyFact
	if len(loadedCache) > 0 {
		since := loadedCache[0].ConsumedRevision
		for _, entry := range loadedCache[1:] {
			since = min(since, entry.ConsumedRevision)
		}
		loadedDirty, err = scoped.ListAnalysisDirtyFacts(since)
		if err != nil {
			return nil, nil, nil, false
		}
	}
	return loadedDirty, loadedCache, loadedPrior, true
}

func listActivePaymentDetections(scoped store.AnalysisStore) ([]types.AnalysisDetection, error) {
	var out []types.AnalysisDetection
	cursor := ""
	for {
		page, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{Cursor: cursor, Limit: 200})
		if err != nil {
			return nil, err
		}
		if len(page) == 0 {
			break
		}
		for _, item := range page {
			cursor = item.ID
			if item.AnalysisType != "payments" || item.Status != "active" {
				continue
			}
			out = append(out, item.AnalysisDetection)
		}
		if len(page) < 200 {
			break
		}
	}
	return out, nil
}
