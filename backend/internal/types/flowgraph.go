package types

// Flow graph contract (VIS-01). Renderer-independent money movement over a
// selected date window: the same JSON feeds any visualization (VIS-02) or
// text/table alternative without renderer-specific shaping.
//
// Movement separation is structural, never inferred:
//   - actual: transaction events whose origin is a manual transaction, including
//     bank-settled rows and claimed actuals, plus settled transactions dated
//     inside the window that the projection never replays as events
//     (history before its start date). Recorded money.
//   - projected: events whose origin is a recurrence-rule instance.
//     Planned money.
// IDs share one namespace across transactions and rules, so an origin is
// exactly one of the two. Future-dated manual transactions still count as
// actual; whether they should read as planned is an open product question.
//
// Direction is structural: from/to follow the transaction route (source to
// destinations, with the external counterparty at the open end) and amounts
// stay signed. A negative realized amount (for example an investment loss
// on an inflow transaction) keeps its route with a negative amount.

// FlowNodeIDExternal is the node ID for the external counterparty: the
// funder of inflows and the receiver of outflows.
const FlowNodeIDExternal = "external"

// Flow movement classes.
const (
	FlowMovementActual    = "actual"
	FlowMovementProjected = "projected"
)

// Flow edge classes. Transfers form their own class and are counted once:
// never duplicated as income plus expense.
const (
	FlowKindInflow   = "inflow"
	FlowKindOutflow  = "outflow"
	FlowKindTransfer = "transfer"
)

// FlowNode is one graph node: a model account or the external counterparty.
// Inflow and Outflow stay non-negative on every node, external included: a
// positive amount increments the from-node Outflow and the to-node Inflow,
// while a negative amount (for example an investment loss kept on its
// structural route) increments the opposite sides instead of flipping
// direction.
type FlowNode struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	External bool    `json:"external"`
	Enabled  bool    `json:"enabled"`
	Inflow   float64 `json:"inflow"`
	Outflow  float64 `json:"outflow"`
}

// FlowSourceRecord names one contributing dated transaction behind an edge.
// Requested and realized amounts are whole-event values: when one event
// splits across destinations, every edge it feeds carries the same record
// while each edge Amount holds only its share.
type FlowSourceRecord struct {
	TransactionID   string  `json:"transactionId"`
	Date            IsoDate `json:"date"`
	Sequence        int     `json:"sequence"`
	RequestedAmount float64 `json:"requestedAmount"`
	RealizedAmount  float64 `json:"realizedAmount"`
}

// FlowEdge is one directed aggregated movement. Amount is the edge's
// realized share over the window; Sources preserves every contributing
// record so a renderer can reveal them on selection. Amount equals the sum
// over Sources' realized amounts only when each contributing event has a
// single destination.
type FlowEdge struct {
	From     string             `json:"from"`
	To       string             `json:"to"`
	Kind     string             `json:"kind"`
	Movement string             `json:"movement"`
	Amount   float64            `json:"amount"`
	Sources  []FlowSourceRecord `json:"sources"`
}

// FlowUnmatchedEvent is an in-window transaction event whose origin names
// no transaction or rule in the effective model. It is excluded from edges and
// reported here so totals stay honest. Planned-purchase spend lands here:
// like the timeline row totals, edges cover transactions and rules only.
type FlowUnmatchedEvent struct {
	TransactionID  string  `json:"transactionId"`
	Date           IsoDate `json:"date"`
	Sequence       int     `json:"sequence"`
	RealizedAmount float64 `json:"realizedAmount"`
}

// FlowUnobservedCorrection is a balance-check correction inside the window:
// money the observations assert without any contributing transaction.
// Model SETs balance; transactions CHANGE it, so a nonzero adjustment is flow
// with no observed path.
type FlowUnobservedCorrection struct {
	AccountID       string  `json:"accountId"`
	Date            IsoDate `json:"date"`
	ObservedBalance float64 `json:"observedBalance"`
	ModeledBalance  float64 `json:"modeledBalance"`
	Adjustment      float64 `json:"adjustment"`
}

// FlowCoverage indicates incomplete institution coverage: enabled accounts
// with no balance observation at or before the window end have unobserved
// starting state, so their flow is partial.
type FlowCoverage struct {
	ObservedAccounts   []string `json:"observedAccounts"`
	UnobservedAccounts []string `json:"unobservedAccounts"`
}

// FlowClassTotals carries per-class realized sums. Transfer is counted
// once here, apart from inflow and outflow.
type FlowClassTotals struct {
	Inflow   float64 `json:"inflow"`
	Outflow  float64 `json:"outflow"`
	Transfer float64 `json:"transfer"`
}

// FlowTotals splits edge totals by movement plus the out-of-edge buckets.
type FlowTotals struct {
	Actual     FlowClassTotals `json:"actual"`
	Projected  FlowClassTotals `json:"projected"`
	Unmatched  float64         `json:"unmatched"`
	Unobserved float64         `json:"unobserved"`
}

// FlowReconciliation lets a renderer verify edge totals against the source
// records they claim to summarize. Event-side sums come from in-window
// transaction events plus replayed settled transactions; edge-side sums come
// from aggregated edges. Reconciled is true only when every class agrees
// exactly.
type FlowReconciliation struct {
	WindowEvents     int     `json:"windowEvents"`
	ClassifiedEvents int     `json:"classifiedEvents"`
	UnmatchedEvents  int     `json:"unmatchedEvents"`
	EventsInflow     float64 `json:"eventsInflow"`
	EventsOutflow    float64 `json:"eventsOutflow"`
	EventsTransfer   float64 `json:"eventsTransfer"`
	EdgesInflow      float64 `json:"edgesInflow"`
	EdgesOutflow     float64 `json:"edgesOutflow"`
	EdgesTransfer    float64 `json:"edgesTransfer"`
	CorrectionsCount int     `json:"correctionsCount"`
	UnobservedSum    float64 `json:"unobservedSum"`
	Reconciled       bool    `json:"reconciled"`
}

// FlowGraph is the complete window contract.
type FlowGraph struct {
	StartDate      IsoDate                    `json:"startDate"`
	EndDate        IsoDate                    `json:"endDate"`
	Nodes          []FlowNode                 `json:"nodes"`
	Edges          []FlowEdge                 `json:"edges"`
	Unmatched      []FlowUnmatchedEvent       `json:"unmatched"`
	Unobserved     []FlowUnobservedCorrection `json:"unobserved"`
	Coverage       FlowCoverage               `json:"coverage"`
	Totals         FlowTotals                 `json:"totals"`
	Reconciliation FlowReconciliation         `json:"reconciliation"`
}
