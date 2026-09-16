// Package simplefin syncs bank balances and pending card charges from a
// SimpleFIN Bridge Access URL into the canonical store. It writes only
// balance checkpoints and projection-disabled pending seed postings, all
// marked source "simplefin". It never materializes checking transactions,
// positive card transactions, or posted charges.
package simplefin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Transaction mirrors the SimpleFIN protocol transaction object. Only the
// fields the sync consumes are modeled.
type Transaction struct {
	ID           string `json:"id"`
	Posted       int64  `json:"posted"`
	Amount       string `json:"amount"`
	Description  string `json:"description"`
	TransactedAt *int64 `json:"transacted_at"`
	Pending      *bool  `json:"pending"`
}

// Account mirrors the SimpleFIN protocol account object.
type Account struct {
	ID               string        `json:"id"`
	Name             string        `json:"name"`
	Currency         string        `json:"currency"`
	Balance          string        `json:"balance"`
	AvailableBalance *string       `json:"available-balance"`
	BalanceDate      int64         `json:"balance-date"`
	Transactions     []Transaction `json:"transactions"`
}

// AccountSet mirrors the top-level GET /accounts response.
type AccountSet struct {
	Accounts []Account `json:"accounts"`
}

// IsPending reports whether the transaction has not yet posted.
func (t Transaction) IsPending() bool {
	if t.Pending != nil {
		return *t.Pending
	}
	return t.Posted == 0
}

// PostedDay returns the transaction day in UTC, preferring transacted_at.
// Missing dates fall back to the caller-supplied now so mapping stays
// deterministic and testable.
func (t Transaction) PostedDay(now time.Time) string {
	stamp := t.Posted
	if t.TransactedAt != nil && *t.TransactedAt > 0 {
		stamp = *t.TransactedAt
	}
	if stamp <= 0 {
		return now.UTC().Format("2006-01-02")
	}
	return time.Unix(stamp, 0).UTC().Format("2006-01-02")
}

// ParseAmount parses the decimal amount string.
func (t Transaction) ParseAmount() (float64, error) {
	amount, err := strconv.ParseFloat(strings.TrimSpace(t.Amount), 64)
	if err != nil {
		return 0, fmt.Errorf("transaction amount %q: %w", t.Amount, err)
	}
	return amount, nil
}

// Client fetches SimpleFIN account sets. The access URL is a secret and must
// never be logged; errors carry only the URL host.
type Client struct {
	AccessURL  string
	HTTPClient *http.Client
}

// Fetch retrieves accounts with transactions in [start, end), including
// pending transactions. The context aborts hung Bridge requests.
func (c *Client) Fetch(ctx context.Context, start, end time.Time) (*AccountSet, error) {
	endpoint, err := url.Parse(strings.TrimRight(c.AccessURL, "/") + "/accounts")
	if err != nil {
		return nil, fmt.Errorf("simplefin access url: %w", redactURLError(endpoint, err))
	}
	query := endpoint.Query()
	query.Set("start-date", strconv.FormatInt(start.Unix(), 10))
	query.Set("end-date", strconv.FormatInt(end.Unix(), 10))
	query.Set("pending", "1")
	endpoint.RawQuery = query.Encode()

	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("simplefin request: %w", redactURLError(endpoint, err))
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("simplefin fetch from %s: %w", endpoint.Host, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("simplefin read from %s: %w", endpoint.Host, err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("simplefin fetch from %s: status %d", endpoint.Host, response.StatusCode)
	}
	var set AccountSet
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("simplefin decode from %s: %w", endpoint.Host, err)
	}
	return &set, nil
}

func redactURLError(endpoint *url.URL, err error) error {
	host := ""
	if endpoint != nil {
		host = endpoint.Host
	}
	return fmt.Errorf("%s: %w", host, err)
}
