package types

// AmountPreset is a saved, reusable amount recipe. Presets persist through
// CRUD instead of living in code: the backend stores the definition rows,
// the UI decides how to present and compose them. A preset is an authoring
// macro only — applying it copies its amount descriptor into a posting or
// rule, so simulation never reads presets and they never affect artifact
// identity, validation, or the canonical model revision.
//
// The amount descriptor may reference placeholder account or posting IDs.
// Placeholders are resolved at authoring time (the UI substitutes real
// IDs), so preset validation checks shape only: known resolver, exact
// required inputs, known providers, finite literals. It never checks
// references against stored data.
type AmountPreset struct {
	ID      string                  `json:"id"`
	Name    string                  `json:"name"`
	Label   string                  `json:"label"`
	Summary string                  `json:"summary,omitempty"`
	WhenUse string                  `json:"whenUse,omitempty"`
	Amount  PostingAmountResolution `json:"amount"`
	Enabled bool                    `json:"enabled"`
}
