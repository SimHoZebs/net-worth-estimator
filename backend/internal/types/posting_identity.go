package types

// RemapPostingReferences updates only fields that refer to posting identities.
// Expression variable names and presentation strings are not row references.
// Import and persisted-data migration share this contract.
func RemapPostingReferences(model *FinancialModel, ids map[string]string) {
	for i := range model.Postings {
		if next, ok := ids[model.Postings[i].ID]; ok {
			model.Postings[i].ID = next
		}
		RemapPostingAmountReferences(&model.Postings[i].Amount, ids)
	}
	for i := range model.RecurrenceRules {
		RemapPostingAmountReferences(&model.RecurrenceRules[i].Amount, ids)
	}
	for _, table := range model.Evaluations.Tables() {
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
