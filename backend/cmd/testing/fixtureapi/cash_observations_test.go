package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestCashObservationsPreserveBankAvailabilityAndScope(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "observations.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	scoped, _, err := integrationfixtures.SeedUser(db, "https://issuer.test", "observations", integrationfixtures.PackBaseline)
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := integrationfixtures.SeedUser(db, "https://issuer.test", "other-observations", integrationfixtures.PackBaseline)
	if err != nil {
		t.Fatal(err)
	}
	beforeOther, err := other.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	handler := cashObservationsHandler(scoped, &sync.RWMutex{})
	const instant = int64(1794679200)
	body := fmt.Sprintf(`{"checkpoints":[{"accountId":"checking","postedBalance":1608.05,"availableBalance":1244.43,"observedAt":%d}]}`, instant)
	for range 2 {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, cashObservationsPath, strings.NewReader(body)))
		var response struct {
			Saved        bool
			Observations int
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || !response.Saved || response.Observations != 1 {
			t.Fatalf("seed: %d %s", w.Code, w.Body.String())
		}
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, cp := range model.Checkpoints {
		if cp.AccountID == "checking" && cp.ObservedAt == instant {
			count++
			if cp.Source != store.SourceBankSync || cp.Balance != 1608.05 || cp.AvailableBalance == nil || *cp.AvailableBalance != 1244.43 {
				t.Fatalf("bank observation lost: %+v", cp)
			}
		}
	}
	if count != 1 {
		t.Fatalf("got %d matching observations", count)
	}
	afterOther, err := other.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(beforeOther, afterOther) {
		t.Fatal("changed another user's model")
	}
}

func TestCashObservationsRejectInvalidBatchWithoutMutation(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "invalid-observations.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	scoped, _, err := integrationfixtures.SeedUser(db, "https://issuer.test", "invalid-observations", integrationfixtures.PackBaseline)
	if err != nil {
		t.Fatal(err)
	}
	before, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	handler := cashObservationsHandler(scoped, &sync.RWMutex{})
	valid := `{"accountId":"checking","postedBalance":1608.05,"availableBalance":1244.43,"observedAt":1794679200}`
	cases := map[string]string{
		"unknown account after valid observation": `{"checkpoints":[` + valid + `,{"accountId":"foreign-account","postedBalance":1,"observedAt":1794679200}]}`,
		"missing balance":                         `{"checkpoints":[{"accountId":"checking","observedAt":1794679200}]}`,
		"invalid instant":                         `{"checkpoints":[{"accountId":"checking","postedBalance":1,"observedAt":0}]}`,
		"future instant":                          `{"checkpoints":[{"accountId":"checking","postedBalance":1,"observedAt":999999999999}]}`,
		"nonfinite balance":                       `{"checkpoints":[{"accountId":"checking","postedBalance":1e999,"observedAt":1794679200}]}`,
		"identity injection":                      `{"userId":"foreign-user","checkpoints":[` + valid + `]}`,
		"empty batch":                             `{"checkpoints":[]}`,
		"duplicate key":                           `{"checkpoints":[` + valid + `,` + valid + `]}`,
		"trailing body":                           `{"checkpoints":[` + valid + `]} {}`,
	}
	if len(before.Checkpoints) > 0 {
		cp := before.Checkpoints[0]
		cases["owner collision"] = fmt.Sprintf(`{"checkpoints":[{"accountId":%q,"postedBalance":1,"observedAt":%d}]}`, cp.AccountID, cp.ObservedAt)
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, cashObservationsPath, strings.NewReader(body)))
			if w.Code != http.StatusBadRequest && w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("accepted invalid batch: %d %s", w.Code, w.Body.String())
			}
			if w.Header().Get("Content-Type") != "application/json" || !json.Valid(w.Body.Bytes()) {
				t.Fatalf("non-JSON error: %s", w.Body.String())
			}
			after, err := scoped.LoadModel()
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected batch changed model")
			}
		})
	}
}
