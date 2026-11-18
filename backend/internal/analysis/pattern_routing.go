package analysis

// sameRouting reports whether two source-plus-destinations pairs route
// identically: both sources nil or equal, plus ordered destination equality.
// Transactions and rules share this comparator so coherence checks and
// rule-matching cannot drift apart.
func sameRouting(aSource *string, aDestinations []string, bSource *string, bDestinations []string) bool {
	if (aSource == nil) != (bSource == nil) {
		return false
	}
	if aSource != nil && *aSource != *bSource {
		return false
	}
	if len(aDestinations) != len(bDestinations) {
		return false
	}
	for i := range aDestinations {
		if aDestinations[i] != bDestinations[i] {
			return false
		}
	}
	return true
}
