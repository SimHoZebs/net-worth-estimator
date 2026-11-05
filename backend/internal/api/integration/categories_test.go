package integration

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedCategoryBankPosting(t *testing.T, scoped store.Store, category string) string {
	t.Helper()
	account := "checking"
	if _, err := scoped.CreateAccount(types.Account{ID: account, Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	extra := map[string]json.RawMessage{}
	if category != "" {
		extra["category"] = json.RawMessage(`"` + category + `"`)
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{
		ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", Transactions: []simplefin.Transaction{{
			ID: "food", Description: "WHOLE FOODS", Amount: "-42.00", Posted: 1785628800, Extra: extra,
		}},
	}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): account}, time.Unix(1785628800, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{account: true})); err != nil {
		t.Fatal(err)
	}
	rows, err := scoped.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	return rows[0].Posting.ID
}

type categoryTransactionRow struct {
	ID             string `json:"id"`
	Category       string `json:"category"`
	CategorySource string `json:"categorySource"`
}

func TestTransactionCategoryRoundTrip(t *testing.T) {
	scoped := openAPIStore(t)
	postingID := seedCategoryBankPosting(t, scoped, "FOOD_AND_DRINK_GROCERIES")
	handler := New(scoped, Config{})

	list := doRowRequest(t, handler, http.MethodGet, "/v1/transactions", "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	var listBody struct {
		Transactions []categoryTransactionRow `json:"transactions"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listBody); err != nil {
		t.Fatal(err)
	}
	if len(listBody.Transactions) != 1 || listBody.Transactions[0].Category != types.CategoryFoodAndDrink || listBody.Transactions[0].CategorySource != types.CategorySourceBank {
		t.Fatalf("list=%+v", listBody.Transactions)
	}

	updated := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+postingID+"/categorize", `{"category":"MEDICAL"}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", updated.Code, updated.Body.String())
	}
	if got := categoryRow(t, handler, postingID); got.Category != types.CategoryMedical || got.CategorySource != types.CategorySourceUser {
		t.Fatalf("updated row=%+v", got)
	}

	reset := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+postingID+"/categorize", `{"category":null}`)
	if reset.Code != http.StatusOK {
		t.Fatalf("reset status=%d body=%s", reset.Code, reset.Body.String())
	}
	if got := categoryRow(t, handler, postingID); got.Category != types.CategoryFoodAndDrink || got.CategorySource != types.CategorySourceBank {
		t.Fatalf("reset row=%+v", got)
	}

	invalid := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+postingID+"/categorize", `{"category":"GROCERIES"}`)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid status=%d body=%s", invalid.Code, invalid.Body.String())
	}
	empty := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+postingID+"/categorize", `{}`)
	if empty.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty body status=%d body=%s, want explicit null to clear", empty.Code, empty.Body.String())
	}
	missing := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/missing/categorize", `{"category":"MEDICAL"}`)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status=%d body=%s", missing.Code, missing.Body.String())
	}
}

func TestTransactionCategoryWriteHonorsReadOnly(t *testing.T) {
	scoped := openAPIStore(t)
	postingID := seedCategoryBankPosting(t, scoped, "")
	handler := New(scoped, Config{ReadOnly: true})
	response := doRowRequest(t, handler, http.MethodPost, "/v1/transactions/"+postingID+"/categorize", `{"category":"MEDICAL"}`)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-only status=%d body=%s", response.Code, response.Body.String())
	}
}

func categoryRow(t *testing.T, handler http.Handler, postingID string) categoryTransactionRow {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodGet, "/v1/transactions", "")
	if response.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Transactions []categoryTransactionRow `json:"transactions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, row := range body.Transactions {
		if row.ID == postingID {
			return row
		}
	}
	t.Fatalf("posting %s not listed", postingID)
	return categoryTransactionRow{}
}
