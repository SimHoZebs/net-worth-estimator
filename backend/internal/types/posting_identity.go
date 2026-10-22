package types

// RemapPostingReferences updates only fields that refer to posting identities.
// Expression variable names and presentation strings are not row references.
// Import and persisted-data migration share this contract.
func RemapPostingReferences(document *FinancialModelDocument, ids map[string]string) {
	for i := range document.Postings {
		if next, ok := ids[document.Postings[i].ID]; ok {
			document.Postings[i].ID = next
		}
		RemapPostingAmountReferences(&document.Postings[i].Amount, ids)
	}
	for i := range document.RecurrenceRules {
		RemapPostingAmountReferences(&document.RecurrenceRules[i].Amount, ids)
	}
	for _, table := range document.Evaluations.Tables() {
		for i := range *table.Rows {
			config, ok := (*table.Rows)[i].Config.(map[string]any)
			if !ok {
				continue
			}
			for _, key := range []string{"postingIds", "continuingPostingIds"} {
				if list, ok := config[key].([]any); ok {
					for j, value := range list {
						if old, ok := value.(string); ok {
							if next, ok := ids[old]; ok {
								list[j] = next
							}
						}
					}
				}
			}
			if table.Type == EvaluationTypeFinancialIndependence {
				sources, _ := config["sources"].([]any)
				for _, value := range sources {
					source, ok := value.(map[string]any)
					if !ok || source["type"] != "cashflow" {
						continue
					}
					if old, ok := source["postingId"].(string); ok {
						if next, ok := ids[old]; ok {
							source["postingId"] = next
						}
					}
				}
			}
		}
	}
}

// RemapPostingAmountReferences preserves the resolver's local input names.
func RemapPostingAmountReferences(amount *PostingAmountResolution, ids map[string]string) {
	for key, binding := range amount.Inputs {
		field := ""
		switch binding.Provider {
		case "model-value":
			field = "id"
		case "late-fee":
			field = "payment"
		}
		if binding.Source != "provider" || field == "" {
			continue
		}
		if old, ok := binding.Arguments[field].(string); ok {
			if next, ok := ids[old]; ok {
				binding.Arguments[field] = next
				amount.Inputs[key] = binding
			}
		}
	}
}
