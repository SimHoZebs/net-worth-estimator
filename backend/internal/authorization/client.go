package authorization

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/sync/singleflight"
)

const (
	DefaultModelID = "waypoint/user-access"
	DefaultAdapter = "user-policy-store"
	maxResponse    = 32 << 10
)

type Config struct {
	Issuer, InternalURL, ClientID, ClientSecret string
	ModelID, Adapter                            string
	// AllowPrivateHTTP opts into plain-HTTP issuers. The operator owns the
	// network boundary and must expose plain HTTP only on a trusted LAN.
	AllowPrivateHTTP bool
}

type Client struct {
	config   Config
	endpoint string
	client   *http.Client
	// inFlight shares one provider call between concurrent Resolve calls
	// for one subject. Only overlapping calls share; sequential calls
	// always recheck, so revoked permissions still fail closed on the
	// next request.
	inFlight singleflight.Group
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

// New constructs a bounded, redirect-free client. It sends no network requests.
func New(config Config) (*Client, error) {
	issuer, err := providerURL(config.Issuer, false)
	if err != nil {
		return nil, fmt.Errorf("authorization issuer: %w", err)
	}
	if issuer.Scheme == "http" && !IsLoopbackHost(issuer.Hostname()) && !config.AllowPrivateHTTP {
		return nil, errors.New("authorization issuer requires HTTPS outside loopback (set NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP=1 to allow plain HTTP on a trusted LAN)")
	}
	if config.ClientID == "" || strings.Contains(config.ClientID, ":") || config.ClientSecret == "" {
		return nil, errors.New("authorization client credentials are required; client ID cannot contain a colon")
	}
	if config.ModelID == "" {
		config.ModelID = DefaultModelID
	}
	parts := strings.Split(config.ModelID, "/")
	if len(parts) != 2 || !identifier.MatchString(parts[0]) || !identifier.MatchString(parts[1]) {
		return nil, errors.New("authorization model ID must be owner/name")
	}
	if config.Adapter == "" {
		config.Adapter = DefaultAdapter
	}
	if !identifier.MatchString(config.Adapter) {
		return nil, errors.New("authorization adapter must be a name without an owner prefix")
	}
	endpoint := *issuer
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/api/batch-enforce"
	endpoint.RawQuery = url.Values{"modelId": {config.ModelID}}.Encode()
	transport := http.DefaultTransport
	if config.InternalURL != "" {
		internal, err := providerURL(config.InternalURL, true)
		if err != nil {
			return nil, fmt.Errorf("authorization internal URL: %w", err)
		}
		transport = &privateTransport{base: transport, internal: internal, publicHost: issuer.Host}
	}
	return &Client{config: config, endpoint: endpoint.String(), client: &http.Client{
		Transport: transport, Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func providerURL(raw string, origin bool) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.RawPath != "" {
		return nil, errors.New("expected an HTTP/S URL without credentials, query, fragment, or encoded path")
	}
	if origin && u.Path != "" && u.Path != "/" {
		return nil, errors.New("expected an origin without a path")
	}
	return u, nil
}

// Resolve checks all user actions for the caller's single server-selected
// user. Sequential invocations always contact Casdoor, including guest and
// denied invocations. Overlapping invocations for one subject share one
// provider call and receive the same fresh decision.
func (c *Client) Resolve(ctx context.Context, subject string) (Scope, error) {
	value, err, _ := c.inFlight.Do(subject, func() (any, error) {
		return c.resolveUnshared(ctx, subject)
	})
	if err != nil {
		return Scope{}, err
	}
	return value.(Scope), nil
}

func (c *Client) resolveUnshared(ctx context.Context, subject string) (Scope, error) {
	resource := ResourceFor(c.config.Issuer, subject)
	actions := []string{Read, Project, Write}
	decisions, err := c.Check(ctx, subject, resource, actions)
	if err != nil {
		return Scope{}, err
	}
	scope := Scope{Resource: resource, Permissions: []string{}}
	for i, allowed := range decisions {
		if allowed {
			scope.Permissions = append(scope.Permissions, actions[i])
		}
	}
	return scope, nil
}

// Check submits server-owned resource metadata without changing its owner to
// match the caller. Decisions are positional and remain entirely provider-owned.
func (c *Client) Check(ctx context.Context, subject string, resource Resource, actions []string) ([]bool, error) {
	if !utf8.ValidString(subject) || strings.ContainsRune(subject, '\x00') || !resource.valid() || len(actions) == 0 || len(actions) > 3 {
		return nil, errors.New("invalid authorization request")
	}
	requests := make([][]string, 0, len(actions))
	for _, action := range actions {
		if action != Read && action != Project && action != Write {
			return nil, errors.New("unknown user action")
		}
		requests = append(requests, []string{ActorKey(c.config.Issuer, subject), resource.ID, action, resource.Owner})
	}
	body, err := json.Marshal(requests)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("cannot construct authorization request")
	}
	request.SetBasicAuth(c.config.ClientID, c.config.ClientSecret)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(request)
	if err != nil {
		return nil, errors.New("authorization provider unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("authorization provider rejected request")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
	if err != nil || len(data) > maxResponse {
		return nil, errors.New("invalid authorization response size")
	}
	return decodeDecisions(data, len(actions), c.config.ModelID+"/"+c.config.Adapter)
}

func decodeDecisions(data []byte, count int, expectedGroup string) ([]bool, error) {
	var response struct {
		Status string    `json:"status"`
		Data   [][]*bool `json:"data"`
		Groups []string  `json:"data2"`
	}
	// Pointer booleans reject JSON null instead of treating it as a valid deny.
	if err := json.Unmarshal(data, &response); err != nil || response.Status != "ok" || response.Data == nil || response.Groups == nil {
		return nil, errors.New("invalid authorization response")
	}
	if len(response.Data) == 0 && len(response.Groups) == 0 {
		return make([]bool, count), nil
	}
	// Seeded permissions share one model/adapter. Never OR independent groups:
	// a second group's allow could otherwise bypass a deny in the first group.
	if len(response.Data) != 1 || len(response.Groups) != 1 || response.Groups[0] != expectedGroup || len(response.Data[0]) != count {
		return nil, errors.New("unexpected authorization result group")
	}
	decisions := make([]bool, count)
	for i, decision := range response.Data[0] {
		if decision == nil {
			return nil, errors.New("invalid authorization decision")
		}
		decisions[i] = *decision
	}
	return decisions, nil
}

type privateTransport struct {
	base       http.RoundTripper
	internal   *url.URL
	publicHost string
}

func (t *privateTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	u := *request.URL
	u.Scheme, u.Host = t.internal.Scheme, t.internal.Host
	clone.URL, clone.Host = &u, t.publicHost
	return t.base.RoundTrip(clone)
}
