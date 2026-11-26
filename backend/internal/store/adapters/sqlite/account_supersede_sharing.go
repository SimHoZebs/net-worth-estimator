package sqlite

// replaceSharingPolicyAccount moves one deleted manual account's automatic
// sharing selection to its synced replacement. The shared policy rewrite bumps
// the version once, re-derives visibility, and audits the substitution.
func replaceSharingPolicyAccount(tx *userTx, oldID, newID string) error {
	return rewriteSharingPolicyAccounts(tx, func(accounts []string) ([]string, bool) {
		if !containsID(accounts, oldID) {
			return accounts, false
		}
		return replaceIDs(accounts, oldID, newID), true
	}, "policy-set", func(before, after []string) map[string]any {
		return map[string]any{
			"replaced_account":    oldID,
			"replacement_account": newID,
		}
	})
}
