package categorization

import (
	"errors"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestDisagreeRatePure(t *testing.T) {
	agree := func(Input) (string, bool) { return types.CategoryFoodAndDrink, true }
	labels := []AssignedLabel{
		{TransactionID: "a", Category: types.CategoryFoodAndDrink, Input: Input{Name: "WHOLE FOODS"}},
		{TransactionID: "b", Category: types.CategoryFoodAndDrink, Input: Input{Name: "TRADER JOES"}},
	}
	if got := DisagreeRate(labels, agree); got != 0 {
		t.Fatalf("rate=%v", got)
	}
	if got := DisagreeRate(nil, agree); got != 0 {
		t.Fatalf("empty rate=%v", got)
	}
	if got := DisagreeRate(labels, nil); got != 0 {
		t.Fatalf("nil decide rate=%v", got)
	}
	split := func(input Input) (string, bool) {
		if input.Name == "AGREE" {
			return types.CategoryFoodAndDrink, true
		}
		return types.CategoryMedical, true
	}
	mixed := []AssignedLabel{
		{Category: types.CategoryFoodAndDrink, Input: Input{Name: "AGREE"}},
		{Category: types.CategoryFoodAndDrink, Input: Input{Name: "OTHER"}},
	}
	if got := DisagreeRate(mixed, split); got != 0.5 {
		t.Fatalf("rate=%v", got)
	}
	abstain := func(Input) (string, bool) { return "", false }
	if got := DisagreeRate(labels, abstain); got != 1 {
		t.Fatalf("abstention must count as disagreement, rate=%v", got)
	}
}

func TestDisagreeThresholdConstants(t *testing.T) {
	// Locked so the monitor contract stays visible: a bounded recent
	// sample, silence below the minimum, and a warn line above 0.30.
	if recentUserLabelSample != 20 || disagreeMinSamples != 10 || disagreeWarnThreshold != 0.30 {
		t.Fatalf("sample=%d min=%d threshold=%v", recentUserLabelSample, disagreeMinSamples, disagreeWarnThreshold)
	}
}

type fakeLabelStore struct {
	store.Store
	labels []types.UserCategoryLabel
	err    error
}

func (f *fakeLabelStore) ListRecentUserCategories(int) ([]types.UserCategoryLabel, error) {
	return f.labels, f.err
}

func labelFor(name, category string) types.UserCategoryLabel {
	return types.UserCategoryLabel{TransactionID: name, Category: category, Name: name, Direction: "out"}
}

func TestDisagreementRateSamplingShape(t *testing.T) {
	if _, _, err := disagreementRate(&fakeLabelStore{err: errors.New("down")}); err == nil {
		t.Fatal("store errors must surface")
	}
	sampled, rate, err := disagreementRate(&fakeLabelStore{})
	if err != nil || sampled != 0 || rate != 0 {
		t.Fatalf("sampled=%d rate=%v err=%v", sampled, rate, err)
	}
	labels := []types.UserCategoryLabel{}
	for index := 0; index < 25; index++ {
		// Keyword-positive names keep the sample unanimous: the shape
		// under test is the bound, not the verdict.
		labels = append(labels, labelFor("SHELL OIL", types.CategoryTransportation))
	}
	capped := &fakeLabelStore{}
	capped.labels = labels[:recentUserLabelSample] // The store bounds the sample.
	sampled, rate, err = disagreementRate(capped)
	if err != nil || sampled != recentUserLabelSample || rate != 0 {
		t.Fatalf("sampled=%d rate=%v err=%v", sampled, rate, err)
	}
	mixed := []types.UserCategoryLabel{
		labelFor("SHELL OIL", types.CategoryTransportation),
		labelFor("SHELL OIL", types.CategoryMedical),
		labelFor("SHELL OIL", types.CategoryMedical),
		labelFor("SHELL OIL", types.CategoryMedical),
	}
	sampled, rate, err = disagreementRate(&fakeLabelStore{labels: mixed})
	if err != nil || sampled != 4 || rate != 0.75 {
		t.Fatalf("sampled=%d rate=%v err=%v", sampled, rate, err)
	}
}
