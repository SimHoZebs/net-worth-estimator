package main

import (
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/receipts"
	receiptmock "github.com/simhozebs/net-worth-estimator/backend/internal/receipts/adapters/mock"
)

// Constructors live only at the composition boundary. New adapters register a
// constructor here; no receipt service, API, persistence, or UI changes follow.
var receiptSourceConstructors = map[string]func() (*receipts.Source, error){
	"mock": receiptmock.New,
}

func configureReceiptSource(value string) (*receipts.Source, error) {
	name := strings.TrimSpace(value)
	if name == "" || name == "disabled" {
		return nil, nil
	}
	constructor, ok := receiptSourceConstructors[name]
	if !ok {
		return nil, fmt.Errorf("unknown receipt source %q", name)
	}
	return constructor()
}
