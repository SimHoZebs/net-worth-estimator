package analysis

import (
	"sort"
	"strings"
)

// ProviderResolver maps a normalized stream merchant to a provider signal such
// as "utility-provider", "insurance-provider", or "card-issuer". Resolution
// runs per stream (dozens per owner), never per transaction, so massive
// provider catalogs stay out of always-loaded runtime memory: a resolver may
// page a store, consult a bounded cache, or embed only a stub map. The nil
// resolver preserves current behavior and contributes no signals.
// Revision versions the catalog behind the resolver; a change invalidates
// analyzer freshness through the version string.
type ProviderResolver interface {
	ProviderSignal(normalizedMerchant string) (signal string, ok bool)
	Revision() string
}

// MapProviderResolver is an in-memory ProviderResolver stub. An empty or nil
// map carries no signals. The full utility and insurance catalogs arrive
// later; this seam keeps them out of the always-loaded detector.
type MapProviderResolver struct {
	Aliases map[string]string
	Rev     string
}

func (m MapProviderResolver) ProviderSignal(normalizedMerchant string) (string, bool) {
	if len(m.Aliases) == 0 {
		return "", false
	}
	signal, ok := m.Aliases[strings.ToLower(strings.TrimSpace(normalizedMerchant))]
	if !ok || signal == "" {
		return "", false
	}
	return signal, true
}

func (m MapProviderResolver) Revision() string { return m.Rev }

// WithProviders attaches a lazy provider catalog to the detector. The
// returned value shares no mutable state with the receiver.
func (p PaymentPatterns) WithProviders(r ProviderResolver) PaymentPatterns {
	p.Providers = r
	return p
}

// enrichStreamsWithProviders appends provider signals to every non-nil view of
// each stream. Views share identity but carry independent signal lists, so
// each view resolves once and repeated passes stay idempotent.
func enrichStreamsWithProviders(resolver ProviderResolver, streams []*paymentStream) {
	if resolver == nil {
		return
	}
	for _, stream := range streams {
		if stream == nil {
			continue
		}
		seen := map[*paymentStream]bool{}
		for _, view := range []*paymentStream{stream, stream.recurrence, stream.nonrepeating, stream.external} {
			if view == nil || seen[view] {
				continue
			}
			seen[view] = true
			signal, ok := resolver.ProviderSignal(view.merchant)
			if !ok || signal == "" {
				continue
			}
			present := false
			for _, existing := range view.signals {
				if existing == signal {
					present = true
					break
				}
			}
			if !present {
				view.signals = append(view.signals, signal)
				sort.Strings(view.signals)
			}
		}
	}
}
