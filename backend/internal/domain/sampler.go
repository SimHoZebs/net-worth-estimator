package domain

import (
	"math"
	"math/rand"
	"sort"
	"sync"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Stochastic sampling utilities ported from utils/stochastic.ts.
//
// Parity notes (docs/backend-migration/ASSUMPTIONS.md A11/A12):
//   - The LCG is reproduced bit-for-bit: intermediate products stay below 2^53
//     so JS double arithmetic is exact; Go int64 math matches it exactly.
//   - Box-Muller uses math.Log/Sqrt/Cos which may differ from V8 by ULPs;
//     golden comparisons over sampled paths allow 1e-12 relative tolerance.

const lcgMask = int64(0x7fffffff)

type lcg struct {
	state int64
}

func newLCG(seed int64) *lcg {
	return &lcg{state: seed & lcgMask}
}

func (l *lcg) next() float64 {
	l.state = (l.state*1664525 + 1013904223) & lcgMask
	return float64(l.state) / float64(lcgMask)
}

// StochasticSampler draws one annual return sample.
type StochasticSampler func(expectedReturn, volatility float64) float64

// NewStochasticSampler builds the seeded (or unseeded) log-normal sampler.
func NewStochasticSampler(seed *int64) StochasticSampler {
	var generator *lcg
	var fallback *rand.Rand
	if seed != nil {
		generator = newLCG(*seed)
	} else {
		fallback = rand.New(rand.NewSource(rand.Int63()))
	}
	uniform := func() float64 {
		if generator != nil {
			return generator.next()
		}
		return fallback.Float64()
	}
	return func(expectedReturn, volatility float64) float64 {
		if volatility <= 0 {
			return expectedReturn
		}
		u := uniform()
		v := uniform()
		standardNormal := math.Sqrt(-2*math.Log(math.Max(u, 1e-10))) * math.Cos(2*math.Pi*v)
		sigma := volatility
		mu := math.Log(1+expectedReturn) - (sigma*sigma)/2
		return math.Exp(mu+sigma*standardNormal) - 1
	}
}

// NormalizeStochasticConfig clamps run counts to [1, 10000].
func NormalizeStochasticConfig(config types.StochasticConfig) types.StochasticConfig {
	runCount := config.RunCount
	if runCount < 1 || runCount > 10_000 {
		runCount = 1
	}
	return types.StochasticConfig{RunCount: runCount, Seed: config.Seed}
}

// MergeSorted merges two ascending slices.
func MergeSorted(a, b []float64) []float64 {
	result := make([]float64, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		if a[i] <= b[j] {
			result = append(result, a[i])
			i++
		} else {
			result = append(result, b[j])
			j++
		}
	}
	result = append(result, a[i:]...)
	result = append(result, b[j:]...)
	return result
}

func quantile(sorted []float64, q float64) float64 {
	pos := q * float64(len(sorted)-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return sorted[lo]
	}
	frac := pos - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

// ComputePercentilesFromSorted returns P10/P25/P50/P75/P90 bands.
func ComputePercentilesFromSorted(sorted []float64) types.PercentileBands {
	if len(sorted) == 0 {
		return types.PercentileBands{}
	}
	return types.PercentileBands{
		P10: quantile(sorted, 0.1),
		P25: quantile(sorted, 0.25),
		P50: quantile(sorted, 0.5),
		P75: quantile(sorted, 0.75),
		P90: quantile(sorted, 0.9),
	}
}

// ComputePercentiles sorts then computes percentile bands.
func ComputePercentiles(values []float64) types.PercentileBands {
	if len(values) == 0 {
		return types.PercentileBands{}
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	return ComputePercentilesFromSorted(sorted)
}

func percentilesToJSON(bands types.PercentileBands) map[string]any {
	return map[string]any{
		"p10": bands.P10,
		"p25": bands.P25,
		"p50": bands.P50,
		"p75": bands.P75,
		"p90": bands.P90,
	}
}

var samplerMutex sync.Mutex

// SampleLogNormal draws using a mutex-guarded shared sampler.
func SampleLogNormal(sampler StochasticSampler, expectedReturn, volatility float64) float64 {
	samplerMutex.Lock()
	defer samplerMutex.Unlock()
	return sampler(expectedReturn, volatility)
}
