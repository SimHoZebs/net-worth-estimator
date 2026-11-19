package integration

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func createScheduleOccurrenceFixture(t *testing.T, handler http.Handler, startDate, endDate string) string {
	t.Helper()
	return createScheduleRecurrenceFixture(t, handler, `{"unit":"month","interval":1,"monthlyMode":"byDate"}`, startDate, endDate)
}

func createScheduleRecurrenceFixture(t *testing.T, handler http.Handler, recurrence, startDate, endDate string) string {
	t.Helper()
	account := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"name":"Checking","kind":"cash","enabled":true}`)
	if account.Code != http.StatusOK {
		t.Fatalf("create account status = %d, body %s", account.Code, account.Body.String())
	}
	var accountPayload struct {
		Result struct {
			ID string `json:"id"`
		} `json:"value"`
	}
	if err := json.Unmarshal(account.Body.Bytes(), &accountPayload); err != nil {
		t.Fatalf("decode account: %v", err)
	}
	body := `{"name":"Rent","destinations":["` + accountPayload.Result.ID + `"],` +
		`"amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},` +
		`"recurrence":` + recurrence + `,"startDate":"` + startDate + `","enabled":true,"priority":1`
	if endDate != "" {
		body += `,"endDate":"` + endDate + `"`
	}
	body += `}`
	created := doRowRequest(t, handler, http.MethodPost, "/v1/schedules", body)
	if created.Code != http.StatusOK {
		t.Fatalf("create schedule status = %d, body %s", created.Code, created.Body.String())
	}
	var schedulePayload struct {
		Result struct {
			ID string `json:"id"`
		} `json:"value"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &schedulePayload); err != nil {
		t.Fatalf("decode schedule: %v", schedulePayload)
	}
	return schedulePayload.Result.ID
}

func decodeOccurrences(t *testing.T, responseBody []byte) (string, []string, string) {
	t.Helper()
	var payload struct {
		ScheduleID  string   `json:"scheduleId"`
		Occurrences []string `json:"occurrences"`
		Revision    string   `json:"revision"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		t.Fatalf("decode occurrences: %v", err)
	}
	return payload.ScheduleID, payload.Occurrences, payload.Revision
}

func TestListScheduleOccurrences(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	t.Run("future occurrences are listed", func(t *testing.T) {
		id := createScheduleOccurrenceFixture(t, handler, "2026-01-15", "")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=2026-04-15", "")
		if response.Code != http.StatusOK {
			t.Fatalf("occurrences status = %d, body %s", response.Code, response.Body.String())
		}
		scheduleID, dates, revision := decodeOccurrences(t, response.Body.Bytes())
		if scheduleID != id {
			t.Fatalf("scheduleId = %q, want %q", scheduleID, id)
		}
		if revision == "" {
			t.Fatal("occurrences response missing revision")
		}
		want := []string{"2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"}
		if strings.Join(dates, ",") != strings.Join(want, ",") {
			t.Fatalf("occurrences = %v, want %v", dates, want)
		}
	})

	t.Run("end date cap applies", func(t *testing.T) {
		id := createScheduleOccurrenceFixture(t, handler, "2026-01-15", "2026-02-15")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=2026-12-31", "")
		if response.Code != http.StatusOK {
			t.Fatalf("occurrences status = %d, body %s", response.Code, response.Body.String())
		}
		_, dates, _ := decodeOccurrences(t, response.Body.Bytes())
		want := []string{"2026-01-15", "2026-02-15"}
		if strings.Join(dates, ",") != strings.Join(want, ",") {
			t.Fatalf("capped occurrences = %v, want %v", dates, want)
		}
	})

	t.Run("default horizon lists months ahead", func(t *testing.T) {
		today := time.Now().UTC().Format("2006-01-02")
		id := createScheduleOccurrenceFixture(t, handler, today, "")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences", "")
		if response.Code != http.StatusOK {
			t.Fatalf("default occurrences status = %d, body %s", response.Code, response.Body.String())
		}
		_, dates, _ := decodeOccurrences(t, response.Body.Bytes())
		// Three calendar months of monthly occurrences: today plus three
		// more. A one-month default would return two; a yearly one dozens.
		if len(dates) != 4 || dates[0] != today {
			t.Fatalf("default occurrences = %v, want 4 monthly dates from %s", dates, today)
		}
	})

	t.Run("every two months lists clamped dates", func(t *testing.T) {
		id := createScheduleRecurrenceFixture(t, handler, `{"unit":"month","interval":2,"monthlyMode":"byDate"}`, "2026-01-15", "")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=2026-05-15", "")
		if response.Code != http.StatusOK {
			t.Fatalf("occurrences status = %d, body %s", response.Code, response.Body.String())
		}
		_, dates, _ := decodeOccurrences(t, response.Body.Bytes())
		want := []string{"2026-01-15", "2026-03-15", "2026-05-15"}
		if strings.Join(dates, ",") != strings.Join(want, ",") {
			t.Fatalf("occurrences = %v, want %v", dates, want)
		}
	})

	t.Run("weekly tuesday and thursday lists both weekdays", func(t *testing.T) {
		id := createScheduleRecurrenceFixture(t, handler, `{"unit":"week","interval":1,"weekdays":[2,4]}`, "2026-01-06", "")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=2026-01-15", "")
		if response.Code != http.StatusOK {
			t.Fatalf("occurrences status = %d, body %s", response.Code, response.Body.String())
		}
		_, dates, _ := decodeOccurrences(t, response.Body.Bytes())
		want := []string{"2026-01-06", "2026-01-08", "2026-01-13", "2026-01-15"}
		if strings.Join(dates, ",") != strings.Join(want, ",") {
			t.Fatalf("occurrences = %v, want %v", dates, want)
		}
	})

	t.Run("monthly third sunday lists the ordinal weekday", func(t *testing.T) {
		id := createScheduleRecurrenceFixture(t, handler, `{"unit":"month","interval":1,"monthlyMode":"byNthWeekday"}`, "2026-01-18", "")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=2026-03-31", "")
		if response.Code != http.StatusOK {
			t.Fatalf("occurrences status = %d, body %s", response.Code, response.Body.String())
		}
		_, dates, _ := decodeOccurrences(t, response.Body.Bytes())
		want := []string{"2026-01-18", "2026-02-15", "2026-03-15"}
		if strings.Join(dates, ",") != strings.Join(want, ",") {
			t.Fatalf("occurrences = %v, want %v", dates, want)
		}
	})

	t.Run("weekly without the start weekday is rejected", func(t *testing.T) {
		account := doRowRequest(t, handler, http.MethodPost, "/v1/accounts", `{"name":"Checking","kind":"cash","enabled":true}`)
		if account.Code != http.StatusOK {
			t.Fatalf("create account status = %d, body %s", account.Code, account.Body.String())
		}
		rejected := doRowRequest(t, handler, http.MethodPost, "/v1/schedules",
			`{"name":"Rent","amount":{"resolver":"expression","config":{"expression":"100"},"inputs":{}},`+
				`"recurrence":{"unit":"week","interval":1,"weekdays":[4]},"startDate":"2026-01-06","enabled":true}`)
		if rejected.Code != http.StatusUnprocessableEntity {
			t.Fatalf("missing weekday status = %d, want 422, body %s", rejected.Code, rejected.Body.String())
		}
	})

	t.Run("unknown schedule is 404", func(t *testing.T) {
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/ghost/occurrences?through=2026-04-15", "")
		if response.Code != http.StatusNotFound {
			t.Fatalf("unknown status = %d, want 404, body %s", response.Code, response.Body.String())
		}
	})

	t.Run("malformed through is 422", func(t *testing.T) {
		id := createScheduleOccurrenceFixture(t, handler, "2026-01-15", "")
		response := doRowRequest(t, handler, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=not-a-date", "")
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("malformed status = %d, want 422, body %s", response.Code, response.Body.String())
		}
	})

	t.Run("read-only serves the read", func(t *testing.T) {
		id := createScheduleOccurrenceFixture(t, handler, "2026-01-15", "")
		readOnly := New(database, Config{ReadOnly: true})
		response := doRowRequest(t, readOnly, http.MethodGet, "/v1/schedules/"+id+"/occurrences?through=2026-02-15", "")
		if response.Code != http.StatusOK {
			t.Fatalf("read-only occurrences status = %d, want 200, body %s", response.Code, response.Body.String())
		}
	})
}
