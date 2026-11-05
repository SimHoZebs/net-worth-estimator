package simplefin

// The tests use one synthetic connection. Production requires the Bridge's
// real conn_id; the helper keeps fixtures on the same key path as runtime.
const testConnID = "conn-test"

func testAccountKey(accountID string) string {
	return AccountKey(testConnID, accountID)
}
