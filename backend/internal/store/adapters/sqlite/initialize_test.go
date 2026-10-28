package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func testInitializeDocument(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	database := newStore(t)
	if document, err := database.LoadDocument(); err != nil || document != nil {
		t.Fatalf("uninitialized document = %+v, %v", document, err)
	}
	for range 2 {
		if err := database.InitializeDocument(); err != nil {
			t.Fatal(err)
		}
	}
	if exists, err := database.DocumentExists(); err != nil || !exists {
		t.Fatalf("initialized presence = %v, %v", exists, err)
	}
	document, err := database.LoadDocument()
	if err != nil || document == nil || len(document.Accounts) != 0 || document.SourcePath != "" {
		t.Fatalf("blank document = %+v, %v", document, err)
	}
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "My checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	before, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if err := database.InitializeDocument(); err != nil {
		t.Fatal(err)
	}
	after, err := database.LoadDocument()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("initialization changed existing document: %+v, %v", after, err)
	}
}
