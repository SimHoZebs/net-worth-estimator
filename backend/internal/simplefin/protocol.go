// Package simplefin mirrors bank activity from a SimpleFIN Bridge Access
// URL into the canonical store. It writes balance checkpoints, pending seed
// rows, and settled owner rows, all traceable to exact bank keys. Nothing
// the bank reported is ever deleted: vanished pending rows convert or void
// in place. It never materializes unmapped accounts, non-USD rows, or
// invalid amounts.
package simplefin

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// ProtocolVersion is the only SimpleFIN protocol version this sync speaks.
// There is no v1 fallback: a response without errlist and connections is
// rejected instead of being coerced into the current shape.
const ProtocolVersion = "2"

const accountKeyPrefix = "sf2"

// AccountKey is the canonical SimpleFIN account identity. Account IDs are
// only unique within a connection, so the connection ID is part of the key.
// Raw URL-safe base64 keeps the value safe in API paths and free of the dot
// separator.
func AccountKey(connID, accountID string) string {
	return accountKeyPrefix + "." +
		base64.RawURLEncoding.EncodeToString([]byte(connID)) + "." +
		base64.RawURLEncoding.EncodeToString([]byte(accountID))
}

// ParseAccountKey decodes a canonical account key. A bare v1 account ID is
// not a valid key, which lets the sync fail closed on an unmigrated store.
func ParseAccountKey(key string) (connID, accountID string, ok bool) {
	parts := strings.Split(key, ".")
	if len(parts) != 3 || parts[0] != accountKeyPrefix || parts[1] == "" || parts[2] == "" {
		return "", "", false
	}
	conn, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(conn) == 0 {
		return "", "", false
	}
	account, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(account) == 0 {
		return "", "", false
	}
	return string(conn), string(account), true
}

// Transaction mirrors the SimpleFIN protocol transaction object. Only the
// fields the sync consumes are modeled.
type Transaction struct {
	ID           string                     `json:"id"`
	Posted       int64                      `json:"posted"`
	Amount       string                     `json:"amount"`
	Description  string                     `json:"description"`
	TransactedAt *int64                     `json:"transacted_at"`
	Pending      *bool                      `json:"pending"`
	Payee        string                     `json:"payee"`
	Memo         string                     `json:"memo"`
	Extra        map[string]json.RawMessage `json:"extra"`
}

// Connection mirrors the v2 top-level connection object. One connection is
// one login link to an institution. Two logins to the same bank share
// organization fields but carry distinct connection IDs.
type Connection struct {
	ConnID  string `json:"conn_id"`
	Name    string `json:"name"`
	OrgID   string `json:"org_id"`
	OrgName string `json:"org_name"`
	OrgURL  string `json:"org_url"`
	SfinURL string `json:"sfin_url"`
}

// Account mirrors the SimpleFIN protocol account object.
type Account struct {
	ID               string        `json:"id"`
	ConnID           string        `json:"conn_id"`
	Name             string        `json:"name"`
	Currency         string        `json:"currency"`
	Balance          string        `json:"balance"`
	AvailableBalance *string       `json:"available-balance"`
	BalanceDate      int64         `json:"balance-date"`
	Holdings         []any         `json:"holdings"`
	Transactions     []Transaction `json:"transactions"`
}

// AccountSet mirrors the top-level GET /accounts response. errlist and
// connections are required v2 markers; the deprecated errors list is not
// read.
type AccountSet struct {
	ErrList     []ProtocolError `json:"errlist"`
	Connections []Connection    `json:"connections"`
	Accounts    []Account       `json:"accounts"`
}

// ProtocolError mirrors one entry of the SimpleFIN errlist array.
type ProtocolError struct {
	Code      string `json:"code"`
	Msg       string `json:"msg"`
	ConnID    string `json:"conn_id"`
	AccountID string `json:"account_id"`
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

// UnsupportedVersionError reports a server that did not return the v2
// response shape. The host is display-safe; the access URL is never included.
type UnsupportedVersionError struct {
	Host string
}

func (e *UnsupportedVersionError) Error() string {
	return fmt.Sprintf("simplefin server at %s does not support protocol version %s", e.Host, ProtocolVersion)
}

// AuthError reports a Bridge or connection authentication failure. The user
// must reconnect or reauthenticate the named connection.
type AuthError struct {
	Host    string
	Message string
}

func (e *AuthError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("simplefin authentication failed at %s; reconnect the key", e.Host)
}

// PaymentRequiredError reports an HTTP 402 from the Bridge.
type PaymentRequiredError struct {
	Host    string
	Message string
}

func (e *PaymentRequiredError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("simplefin payment is required at %s", e.Host)
}

// ProtocolErrorsError reports errors that make the whole snapshot unsafe to
// apply. Connection and account scoped errors are excluded instead.
type ProtocolErrorsError struct {
	Host   string
	Errors []ProtocolError
}

func (e *ProtocolErrorsError) Error() string {
	if len(e.Errors) == 0 {
		return fmt.Sprintf("simplefin protocol error from %s", e.Host)
	}
	first := e.Errors[0]
	code := first.Code
	if code == "" {
		code = "unknown"
	}
	message := sanitizeMessage(first.Msg)
	if message == "" {
		message = code
	}
	return fmt.Sprintf("simplefin protocol error from %s: %s", e.Host, message)
}

// RateLimitedError reports that the Bridge refused a fetch for quota
// reasons: HTTP 429, or a 200/4xx body carrying a rate-limit message in
// errlist. Callers must back off instead of retrying immediately so one
// frontend burst cannot cost the Access Token.
type RateLimitedError struct {
	RetryAfter time.Duration
	Message    string
}

func (e *RateLimitedError) Error() string {
	if e == nil {
		return "simplefin rate limited"
	}
	if e.Message != "" {
		return e.Message
	}
	return "simplefin bridge rate limited"
}

func isRateLimitMessage(value string) bool {
	lowered := strings.ToLower(value)
	return strings.Contains(lowered, "too many requests") ||
		strings.Contains(lowered, "rate limit") ||
		strings.Contains(lowered, "rate-limit")
}

func (e ProtocolError) class() string {
	prefix, _, _ := strings.Cut(strings.TrimSpace(e.Code), ".")
	return prefix
}

func (e ProtocolError) isRateLimit() bool {
	return isRateLimitMessage(e.Msg) || isRateLimitMessage(e.Code)
}

// rateLimitMessage returns the first Bridge rate-limit message in errlist,
// or "" when absent. v2 has no deprecated errors list.
func (s *AccountSet) rateLimitMessage() string {
	if s == nil {
		return ""
	}
	for _, entry := range s.ErrList {
		if entry.isRateLimit() {
			if entry.Msg != "" {
				return entry.Msg
			}
			return entry.Code
		}
	}
	return ""
}

// Exclusions lists connections and accounts whose errors make their rows
// unsafe to apply. General errors fail the whole fetch before this runs.
type Exclusions struct {
	Connections map[string]struct{}
	Accounts    map[string]struct{}
}

// Excluded reports whether one bridge account must be skipped.
func (x Exclusions) Excluded(connID, accountID string) bool {
	if _, ok := x.Connections[connID]; ok {
		return true
	}
	_, ok := x.Accounts[AccountKey(connID, accountID)]
	return ok
}

// Exclusions derives the connection- and account-scoped exclusions.
func (s *AccountSet) Exclusions() Exclusions {
	out := Exclusions{Connections: map[string]struct{}{}, Accounts: map[string]struct{}{}}
	if s == nil {
		return out
	}
	accountsByID := map[string][]Account{}
	for _, account := range s.Accounts {
		accountsByID[account.ID] = append(accountsByID[account.ID], account)
	}
	for _, entry := range s.ErrList {
		switch entry.class() {
		case "con":
			out.Connections[entry.ConnID] = struct{}{}
		case "act":
			connID := entry.ConnID
			if connID == "" {
				if matches := accountsByID[entry.AccountID]; len(matches) == 1 {
					connID = matches[0].ConnID
				}
			}
			out.Accounts[AccountKey(connID, entry.AccountID)] = struct{}{}
		}
	}
	return out
}

// classifyProtocolErrors returns a whole-run error for general errors,
// authentication failures, and ambiguous scoped errors. Connection and
// account errors that can be excluded are left in ErrList for Exclusions.
func (s *AccountSet) classifyProtocolErrors(host string) error {
	if s == nil {
		return nil
	}
	accountsByID := map[string][]Account{}
	for _, account := range s.Accounts {
		accountsByID[account.ID] = append(accountsByID[account.ID], account)
	}
	var general []ProtocolError
	for _, entry := range s.ErrList {
		switch entry.class() {
		case "gen":
			if entry.Code == "gen.auth" {
				return &AuthError{Host: host, Message: authMessage(host, entry)}
			}
			general = append(general, entry)
		case "con":
			if strings.TrimSpace(entry.ConnID) == "" {
				general = append(general, entry)
			}
		case "act":
			if strings.TrimSpace(entry.AccountID) == "" {
				general = append(general, entry)
				continue
			}
			if strings.TrimSpace(entry.ConnID) == "" && len(accountsByID[entry.AccountID]) > 1 {
				general = append(general, entry)
			}
		default:
			general = append(general, entry)
		}
	}
	if len(general) > 0 {
		return &ProtocolErrorsError{Host: host, Errors: general}
	}
	return nil
}

func authMessage(host string, entry ProtocolError) string {
	if message := sanitizeMessage(entry.Msg); message != "" && message != "Forbidden" {
		return fmt.Sprintf("simplefin authentication failed at %s: %s", host, message)
	}
	return fmt.Sprintf("simplefin authentication failed at %s; reconnect the key", host)
}

func sanitizeMessage(value string) string {
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, value)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	runes := []rune(cleaned)
	if len(runes) > 200 {
		return string(runes[:200])
	}
	return cleaned
}

// parseRetryAfter converts a Retry-After header to a wait duration: integer
// seconds per RFC 7231, falling back to an HTTP date. Missing or invalid
// headers yield 0 so callers apply their configured cooldown.
func parseRetryAfter(header http.Header, now time.Time) time.Duration {
	value := strings.TrimSpace(header.Get("Retry-After"))
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil {
		if seconds < 0 {
			return 0
		}
		return time.Duration(seconds) * time.Second
	}
	if when, err := time.Parse(http.TimeFormat, value); err == nil {
		if wait := when.Sub(now); wait > 0 {
			return wait
		}
	}
	return 0
}

// StatusError reports a non-200 Bridge fetch that is not a quota signal.
// 5xx values are transient; 4xx values are permanent (bad key, bad request).
type StatusError struct {
	Host       string
	StatusCode int
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("simplefin fetch from %s: status %d", e.Host, e.StatusCode)
}

// Client fetches SimpleFIN account sets. The access URL is a secret. Protocol
// errors carry only the host, but transport errors can wrap the request URL;
// callers must redact those errors before external logging or API responses.
type Client struct {
	AccessURL  string
	HTTPClient *http.Client
}

// Fetch retrieves accounts with transactions in [start, end), including
// pending transactions. It requests protocol version 2 and rejects a v1
// response instead of silently applying the old shape.
func (c *Client) Fetch(ctx context.Context, start, end time.Time) (*AccountSet, error) {
	endpoint, err := url.Parse(strings.TrimRight(c.AccessURL, "/") + "/accounts")
	if err != nil {
		return nil, fmt.Errorf("simplefin access url: %w", redactURLError(endpoint, err))
	}
	query := endpoint.Query()
	query.Set("start-date", strconv.FormatInt(start.Unix(), 10))
	query.Set("end-date", strconv.FormatInt(end.Unix(), 10))
	query.Set("pending", "1")
	query.Set("version", ProtocolVersion)
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
	if response.StatusCode == http.StatusTooManyRequests {
		retryAfter := parseRetryAfter(response.Header, time.Now())
		return nil, &RateLimitedError{
			RetryAfter: retryAfter,
			Message:    fmt.Sprintf("simplefin bridge rate limited (status 429 from %s)", endpoint.Host),
		}
	}
	if response.StatusCode != http.StatusOK {
		if set, decodeErr := decodeErrorAccountSet(body); decodeErr == nil && set != nil {
			if message := set.rateLimitMessage(); message != "" {
				return nil, &RateLimitedError{
					RetryAfter: parseRetryAfter(response.Header, time.Now()),
					Message:    fmt.Sprintf("simplefin bridge rate limited (status %d from %s): %s", response.StatusCode, endpoint.Host, sanitizeMessage(message)),
				}
			}
			if auth := classifyAuthError(endpoint.Host, set); auth != nil {
				return nil, auth
			}
		}
		if response.StatusCode == http.StatusPaymentRequired {
			return nil, &PaymentRequiredError{Host: endpoint.Host, Message: "simplefin payment is required; check the bridge subscription"}
		}
		if isRateLimitMessage(string(body)) {
			return nil, &RateLimitedError{
				RetryAfter: parseRetryAfter(response.Header, time.Now()),
				Message:    fmt.Sprintf("simplefin bridge rate limited (status %d from %s)", response.StatusCode, endpoint.Host),
			}
		}
		return nil, &StatusError{Host: endpoint.Host, StatusCode: response.StatusCode}
	}
	set, err := decodeAccountSet(endpoint.Host, body)
	if err != nil {
		return nil, err
	}
	if message := set.rateLimitMessage(); message != "" {
		return nil, &RateLimitedError{
			Message: fmt.Sprintf("simplefin bridge rate limited from %s: %s", endpoint.Host, sanitizeMessage(message)),
		}
	}
	if err := set.classifyProtocolErrors(endpoint.Host); err != nil {
		return nil, err
	}
	return set, nil
}

func decodeAccountSet(host string, body []byte) (*AccountSet, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return nil, fmt.Errorf("simplefin decode from %s: %w", host, err)
	}
	errList, hasErrList := fields["errlist"]
	connections, hasConnections := fields["connections"]
	if !hasErrList || !hasConnections {
		return nil, &UnsupportedVersionError{Host: host}
	}
	if !jsonArray(errList) || !jsonArray(connections) {
		return nil, &ProtocolErrorsError{Host: host, Errors: []ProtocolError{{Code: "gen.protocol", Msg: "errlist and connections must be arrays"}}}
	}
	var set AccountSet
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("simplefin decode from %s: %w", host, err)
	}
	for _, connection := range set.Connections {
		if strings.TrimSpace(connection.ConnID) == "" {
			return nil, &ProtocolErrorsError{Host: host, Errors: []ProtocolError{{Code: "gen.protocol", Msg: "connection is missing conn_id"}}}
		}
	}
	for _, account := range set.Accounts {
		if strings.TrimSpace(account.ID) == "" || strings.TrimSpace(account.ConnID) == "" {
			return nil, &ProtocolErrorsError{Host: host, Errors: []ProtocolError{{Code: "gen.protocol", Msg: "account is missing id or conn_id"}}}
		}
	}
	return &set, nil
}

// decodeErrorAccountSet reads the structured error list from a non-200 body.
// Error responses are not required to carry the success-response markers.
func decodeErrorAccountSet(body []byte) (*AccountSet, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	if _, ok := fields["errlist"]; !ok {
		return nil, nil
	}
	var set AccountSet
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, err
	}
	return &set, nil
}

// jsonArray reports whether a required protocol marker is a JSON array. A
// null or object value is not a usable v2 marker.
func jsonArray(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '['
}

func classifyAuthError(host string, set *AccountSet) *AuthError {
	for _, entry := range set.ErrList {
		if entry.Code == "gen.auth" {
			return &AuthError{Host: host, Message: authMessage(host, entry)}
		}
	}
	return nil
}

func redactURLError(endpoint *url.URL, err error) error {
	host := ""
	if endpoint != nil {
		host = endpoint.Host
	}
	return fmt.Errorf("%s: %w", host, err)
}
