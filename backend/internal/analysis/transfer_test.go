package analysis

import (
	"context"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func transferTransaction(id, account, provider, description, amount string, day int) types.AnalysisTransaction {
	return types.AnalysisTransaction{
		PostingID: id, AccountID: account, SourceProvider: provider,
		Facts: types.TransactionFacts{
			Description: description, Amount: amount, Currency: "USD",
			PostedTime: time.Date(2026, time.January, day, 12, 0, 0, 0, time.UTC).Unix(),
			Metadata:   map[string]string{},
		},
	}
}

func analyzeTransfer(t *testing.T, items []types.AnalysisTransaction) []types.AnalysisDetection {
	t.Helper()
	result, err := (Transfer{}).Analyze(context.Background(), types.AnalysisSnapshot{Transactions: items})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestTransferCreditCardPaymentPair(t *testing.T) {
	items := []types.AnalysisTransaction{
		transferTransaction("checking-leg", "checking-bridge", "simplefin", "CHASE CREDIT CARD PAYMENT", "-500.00", 5),
		transferTransaction("card-leg", "card-bridge", "simplefin", "PAYMENT RECEIVED", "500.00", 6),
	}
	result := analyzeTransfer(t, items)
	if len(result) != 2 {
		t.Fatalf("result=%+v", result)
	}
	byID := map[string]types.AnalysisDetection{}
	for _, item := range result {
		byID[item.PostingID] = item
	}
	outflow, inflow := byID["checking-leg"], byID["card-leg"]
	if outflow.Role != "outflow" || inflow.Role != "inflow" {
		t.Fatalf("roles=%+v", result)
	}
	for _, item := range result {
		if item.Kind != "transfer" || item.Strength != "strong" || item.Product != "internal-transfer" {
			t.Fatalf("finding=%+v", item)
		}
		if len(item.Evidence) != 1 || item.Evidence[0].Code != "transfer.exact-leg-match" || len(item.Evidence[0].PostingIDs) != 2 {
			t.Fatalf("evidence=%+v", item)
		}
	}
	if outflow.Evidence[0].PostingIDs[1] != "card-leg" || inflow.Evidence[0].PostingIDs[1] != "checking-leg" {
		t.Fatalf("legs do not reference each other: %+v", result)
	}
}

func TestTransferNeverFabricatesMissingLeg(t *testing.T) {
	single := []types.AnalysisTransaction{transferTransaction("lonely", "checking-bridge", "simplefin", "TRANSFER OUT", "-100.00", 5)}
	if result := analyzeTransfer(t, single); len(result) != 0 {
		t.Fatalf("fabricated a leg: %+v", result)
	}
	sameAccount := []types.AnalysisTransaction{
		transferTransaction("a", "checking-bridge", "simplefin", "ADJUSTMENT", "-100.00", 5),
		transferTransaction("b", "checking-bridge", "simplefin", "REVERSAL", "100.00", 5),
	}
	if result := analyzeTransfer(t, sameAccount); len(result) != 0 {
		t.Fatalf("same-account correction flagged as transfer: %+v", result)
	}
	farApart := []types.AnalysisTransaction{
		transferTransaction("a", "checking-bridge", "simplefin", "TRANSFER OUT", "-100.00", 1),
		transferTransaction("b", "savings-bridge", "simplefin", "TRANSFER IN", "100.00", 20),
	}
	if result := analyzeTransfer(t, farApart); len(result) != 0 {
		t.Fatalf("out-of-window pair matched: %+v", result)
	}
}

func TestTransferAmbiguousLegsStayForReview(t *testing.T) {
	items := []types.AnalysisTransaction{
		transferTransaction("out", "checking-bridge", "bank-a", "TRANSFER OUT", "-200.00", 5),
		transferTransaction("in-one", "savings-bridge", "bank-b", "TRANSFER IN", "200.00", 5),
		transferTransaction("in-two", "savings-bridge", "bank-b", "TRANSFER IN", "200.00", 6),
	}
	result := analyzeTransfer(t, items)
	if len(result) != 3 {
		t.Fatalf("result=%+v", result)
	}
	for _, item := range result {
		if item.Strength != "moderate" || item.Evidence[0].Code != "transfer.ambiguous-legs" {
			t.Fatalf("ambiguous leg left review: %+v", item)
		}
	}
	byID := map[string]types.AnalysisDetection{}
	for _, item := range result {
		byID[item.PostingID] = item
	}
	if len(byID["out"].Evidence[0].PostingIDs) != 3 {
		t.Fatalf("outflow evidence=%+v", byID["out"])
	}
}

func TestTransferDuplicatePairsStayAmbiguous(t *testing.T) {
	items := []types.AnalysisTransaction{
		transferTransaction("out-one", "checking-bridge", "simplefin", "TRANSFER OUT", "-50.00", 5),
		transferTransaction("out-two", "checking-bridge", "simplefin", "TRANSFER OUT", "-50.00", 5),
		transferTransaction("in-one", "savings-bridge", "simplefin", "TRANSFER IN", "50.00", 5),
		transferTransaction("in-two", "savings-bridge", "simplefin", "TRANSFER IN", "50.00", 5),
	}
	result := analyzeTransfer(t, items)
	if len(result) != 4 {
		t.Fatalf("result=%+v", result)
	}
	for _, item := range result {
		if item.Strength != "moderate" {
			t.Fatalf("indistinguishable duplicate marked strong: %+v", item)
		}
	}
}

func TestTransferSkipsUnusableEvidence(t *testing.T) {
	items := []types.AnalysisTransaction{
		transferTransaction("good-out", "checking-bridge", "simplefin", "TRANSFER OUT", "-75.00", 5),
		transferTransaction("good-in", "savings-bridge", "simplefin", "TRANSFER IN", "75.00", 5),
	}
	pending := transferTransaction("pending-in", "other-bridge", "simplefin", "TRANSFER IN", "75.00", 5)
	pending.Pending = true
	voided := transferTransaction("void-in", "other-bridge", "simplefin", "TRANSFER IN", "75.00", 5)
	voided.Void = true
	foreign := transferTransaction("eur-in", "other-bridge", "simplefin", "TRANSFER IN", "75.00", 5)
	foreign.Facts.Currency = "EUR"
	zero := transferTransaction("zero-in", "other-bridge", "simplefin", "TRANSFER IN", "0.00", 5)
	badAmount := transferTransaction("bad-in", "other-bridge", "simplefin", "TRANSFER IN", "NaN", 5)
	noStamp := transferTransaction("nostamp-in", "other-bridge", "simplefin", "TRANSFER IN", "75.00", 5)
	noStamp.Facts.PostedTime = 0
	items = append(items, pending, voided, foreign, zero, badAmount, noStamp)
	result := analyzeTransfer(t, items)
	if len(result) != 2 {
		t.Fatalf("result=%+v", result)
	}
	for _, item := range result {
		if item.Strength != "strong" {
			t.Fatalf("usable pair weakened by unusable rows: %+v", item)
		}
	}
}

func TestTransferContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	items := []types.AnalysisTransaction{transferTransaction("a", "x", "simplefin", "TRANSFER OUT", "-1.00", 1)}
	if _, err := (Transfer{}).Analyze(ctx, types.AnalysisSnapshot{Transactions: items}); err != context.Canceled {
		t.Fatalf("cancellation=%v", err)
	}
	if got := (Transfer{}).Type(); got != "transfer" {
		t.Fatalf("type=%q", got)
	}
	if got := (Transfer{}).Version(); got != TransferVersion {
		t.Fatalf("version=%q", got)
	}
}
