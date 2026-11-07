package simplefin

import (
	"testing"
)

func TestProvisionsCarryConnectionInstitution(t *testing.T) {
	set := &AccountSet{
		Connections: []Connection{
			{ConnID: "CON-1", Name: "My Bank - James", OrgID: "ORG-1", OrgName: "Chase"},
			{ConnID: "CON-2", Name: "Login Only", OrgName: ""},
		},
		Accounts: []Account{
			{ID: "checking", ConnID: "CON-1", Name: "Checking 8472", Currency: "USD", Balance: "10"},
			{ID: "savings", ConnID: "CON-2", Name: "Savings", Currency: "USD", Balance: "20"},
			{ID: "orphan", ConnID: "CON-9", Name: "Orphan", Currency: "USD", Balance: "1"},
		},
	}
	provisions := bridgeAdapter{}.Provisions(set)
	if len(provisions) != 3 {
		t.Fatalf("provisions = %d, want 3", len(provisions))
	}
	if provisions[0].Institution != "Chase" {
		t.Errorf("first institution = %q, want Chase", provisions[0].Institution)
	}
	if provisions[1].Institution != "Login Only" {
		t.Errorf("second institution = %q, want connection name fallback", provisions[1].Institution)
	}
	if provisions[2].Institution != "" {
		t.Errorf("orphan institution = %q, want empty", provisions[2].Institution)
	}
	if provisions[0].Name != "Checking 8472" {
		t.Errorf("name changed = %q, want bridge name verbatim", provisions[0].Name)
	}
}

func TestFirstSyncStoresInstitutionOnLink(t *testing.T) {
	// Covered end-to-end by TestFirstSyncImportsCheckpointAndSettledTogether
	// once account_links carries institution; direct unit check of the
	// provision path lives in TestProvisionsCarryConnectionInstitution.
	provisions := bridgeAdapter{}.Provisions(&AccountSet{
		Connections: []Connection{{ConnID: "C1", OrgName: "Chase"}},
		Accounts:    []Account{{ID: "a1", ConnID: "C1", Name: "Checking"}},
	})
	if len(provisions) != 1 || provisions[0].Institution != "Chase" {
		t.Fatalf("provisions = %+v, want one Chase account", provisions)
	}
}
