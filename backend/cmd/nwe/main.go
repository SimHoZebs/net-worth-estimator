// Command nwe is the user CLI for the net-worth-estimator API. Sign-in runs
// an RFC 8628 device flow against the server's Casdoor application: the
// CLI never sees a password or the application secret. Cached credentials
// live owner-only on disk and refresh without browser interaction.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultAPI = "http://127.0.0.1:8787"

func apiBaseURL(value string) string {
	if value != "" {
		return strings.TrimRight(value, "/")
	}
	if value = os.Getenv("NWE_API"); value != "" {
		return strings.TrimRight(value, "/")
	}
	return defaultAPI
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "nwe:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: nwe <login|logout|status|api> [flags]")
	}
	switch args[0] {
	case "login":
		return runLogin(args[1:])
	case "logout":
		return runLogout(args[1:])
	case "status":
		return runStatus(args[1:])
	case "api":
		return runAPI(args[1:])
	default:
		return fmt.Errorf("unknown command %q: want login, logout, status, or api", args[0])
	}
}

func commonFlags(name string, args []string) (string, []string, error) {
	set := flag.NewFlagSet(name, flag.ContinueOnError)
	api := set.String("api", "", "API base URL (default $NWE_API or "+defaultAPI+")")
	if err := set.Parse(args); err != nil {
		return "", nil, err
	}
	return apiBaseURL(*api), set.Args(), nil
}

func rejectSurplus(command string, rest []string) error {
	if len(rest) != 0 {
		return fmt.Errorf("usage: nwe %s [--api URL]", command)
	}
	return nil
}

// tokenExpiry interprets the provider lifetime with a floor so an omitted
// or zero expires_in still yields usable credentials instead of an
// instantly expired cache.
func tokenExpiry(expiresIn int) time.Time {
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	return time.Now().Add(time.Duration(expiresIn) * time.Second)
}

func postJSON(client *http.Client, url string, body any, headers map[string]string) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(http.MethodPost, url, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return 0, nil, err
	}
	return response.StatusCode, payload, nil
}

func runLogin(args []string) error {
	base, rest, err := commonFlags("login", args)
	if err != nil {
		return err
	}
	if err := rejectSurplus("login", rest); err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	status, payload, err := postJSON(client, base+"/v1/auth/device/start", nil, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("device start failed: HTTP %d", status)
	}
	var start struct {
		VerificationURI string `json:"verificationUri"`
		UserCode        string `json:"userCode"`
		DeviceCode      string `json:"deviceCode"`
		ExpiresIn       int    `json:"expiresIn"`
		Interval        int    `json:"interval"`
	}
	if err := json.Unmarshal(payload, &start); err != nil || start.VerificationURI == "" || start.UserCode == "" || start.DeviceCode == "" {
		return errors.New("device start returned an unusable response")
	}
	fmt.Printf("Open %s and enter code %s, then wait here.\n", start.VerificationURI, start.UserCode)
	interval := time.Duration(start.Interval) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	deadline := time.Now().Add(time.Duration(start.ExpiresIn) * time.Second)
	if start.ExpiresIn <= 0 {
		deadline = time.Now().Add(10 * time.Minute)
	}
	for {
		if time.Now().After(deadline) {
			return errors.New("device sign-in expired; run nwe login again")
		}
		time.Sleep(interval)
		status, payload, err := postJSON(client, base+"/v1/auth/device/poll", map[string]string{"deviceCode": start.DeviceCode}, nil)
		if err != nil {
			return err
		}
		var poll struct {
			Status       string `json:"status"`
			Subject      string `json:"subject"`
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
			ExpiresIn    int    `json:"expiresIn"`
		}
		if err := json.Unmarshal(payload, &poll); err != nil {
			return fmt.Errorf("device poll failed: HTTP %d", status)
		}
		switch {
		case status == http.StatusOK && poll.Status == "pending":
			continue
		case status == http.StatusOK && poll.Status == "complete" && poll.AccessToken != "" && poll.RefreshToken != "":
			credentials := credentials{Subject: poll.Subject, AccessToken: poll.AccessToken, RefreshToken: poll.RefreshToken, Expiry: tokenExpiry(poll.ExpiresIn)}
			resource, err := fetchResource(client, base, credentials)
			if err != nil {
				return err
			}
			credentials.ResourceID = resource
			if err := saveCredentials(credentials); err != nil {
				return err
			}
			fmt.Println("Signed in.")
			return nil
		case status == http.StatusGone:
			return errors.New("device sign-in expired; run nwe login again")
		case status == http.StatusForbidden:
			return errors.New("device sign-in was declined")
		default:
			return fmt.Errorf("device poll failed: HTTP %d", status)
		}
	}
}

// fetchResource reports the caller's user so later requests can assert it.
func fetchResource(client *http.Client, base string, credentials credentials) (string, error) {
	request, err := http.NewRequest(http.MethodGet, base+"/v1/auth/session", nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+credentials.AccessToken)
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 32<<10))
	if err != nil {
		return "", err
	}
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("session lookup failed: HTTP %d", response.StatusCode)
	}
	var session struct {
		Resource struct {
			ID string `json:"id"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(payload, &session); err != nil || session.Resource.ID == "" {
		return "", errors.New("session lookup returned no user")
	}
	return session.Resource.ID, nil
}

func runLogout(args []string) error {
	if _, rest, err := commonFlags("logout", args); err != nil {
		return err
	} else if err := rejectSurplus("logout", rest); err != nil {
		return err
	}
	if err := clearCredentials(); err != nil {
		return err
	}
	fmt.Println("Signed out on this machine. Tokens already issued expire on their own; revoke them from the account page to cut them off immediately.")
	return nil
}

func runStatus(args []string) error {
	base, rest, err := commonFlags("status", args)
	if err != nil {
		return err
	}
	if err := rejectSurplus("status", rest); err != nil {
		return err
	}
	credentials, err := loadCredentials()
	if err != nil {
		return err
	}
	if credentials.AccessToken == "" {
		fmt.Println("Not signed in. Run nwe login.")
		return nil
	}
	client := &http.Client{Timeout: 30 * time.Second}
	if time.Until(credentials.Expiry) < time.Minute {
		refreshed, err := refreshCredentials(client, base, credentials)
		if err != nil {
			return err
		}
		credentials = refreshed
	}
	fmt.Printf("Signed in as %s; access token expires %s.\n", credentials.Subject, credentials.Expiry.Local().Format(time.RFC1123))
	return nil
}

func runAPI(args []string) error {
	base, rest, err := commonFlags("api", args)
	if err != nil {
		return err
	}
	if len(rest) < 2 {
		return errors.New("usage: nwe api [--api URL] METHOD PATH [--data @file|-] [--resource ID]")
	}
	method, path := strings.ToUpper(rest[0]), rest[1]
	if !strings.HasPrefix(path, "/") {
		return fmt.Errorf("path must start with /: %q", path)
	}
	dataSet := flag.NewFlagSet("api-data", flag.ContinueOnError)
	data := dataSet.String("data", "", "request body (@file for a file, - for stdin)")
	resource := dataSet.String("resource", "", "user resource ID (default cached)")
	if err := dataSet.Parse(rest[2:]); err != nil {
		return err
	}
	if len(dataSet.Args()) != 0 {
		return errors.New("usage: nwe api [--api URL] METHOD PATH [--data @file|-] [--resource ID]")
	}
	var raw []byte
	if *data != "" {
		switch {
		case *data == "-":
			raw, err = io.ReadAll(io.LimitReader(os.Stdin, 8<<20))
		case strings.HasPrefix(*data, "@"):
			raw, err = os.ReadFile(strings.TrimPrefix(*data, "@"))
		default:
			raw = []byte(*data)
		}
		if err != nil {
			return fmt.Errorf("read request body: %w", err)
		}
	}
	credentials, err := loadCredentials()
	if err != nil {
		return err
	}
	if credentials.AccessToken == "" {
		return errors.New("not signed in; run nwe login")
	}
	client := &http.Client{Timeout: 60 * time.Second}
	if time.Until(credentials.Expiry) < time.Minute && credentials.RefreshToken != "" {
		refreshed, err := refreshCredentials(client, base, credentials)
		if err != nil {
			return err
		}
		credentials = refreshed
	}
	send := func(resource string) (int, []byte, error) {
		var body io.Reader
		if raw != nil {
			body = bytes.NewReader(raw)
		}
		request, err := http.NewRequest(method, base+path, body)
		if err != nil {
			return 0, nil, err
		}
		if body != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Authorization", "Bearer "+credentials.AccessToken)
		if resource != "" {
			request.Header.Set("Waypoint-Resource", resource)
		}
		response, err := client.Do(request)
		if err != nil {
			return 0, nil, err
		}
		defer response.Body.Close()
		payload, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
		if err != nil {
			return 0, nil, err
		}
		return response.StatusCode, payload, nil
	}
	resID := *resource
	if resID == "" {
		resID = credentials.ResourceID
	}
	status, payload, err := send(resID)
	if err != nil {
		return err
	}
	if status == http.StatusConflict && *resource == "" {
		// The cached user assertion went stale (user recreated or
		// switched). Re-resolve once and retry before giving up.
		refreshed, ferr := fetchResource(client, base, credentials)
		if ferr != nil {
			return fmt.Errorf("user changed and re-resolution failed (%v); run nwe login again", ferr)
		}
		credentials.ResourceID = refreshed
		if err := saveCredentials(credentials); err != nil {
			return fmt.Errorf("user changed; could not update cache: %w", err)
		}
		status, payload, err = send(refreshed)
		if err != nil {
			return err
		}
	}
	fmt.Printf("HTTP %d\n%s\n", status, payload)
	if status >= 400 {
		return fmt.Errorf("request failed: HTTP %d", status)
	}
	return nil
}

func refreshCredentials(client *http.Client, base string, credentials credentials) (credentials, error) {
	if credentials.RefreshToken == "" {
		return credentials, errors.New("no refresh token; run nwe login")
	}
	status, payload, err := postJSON(client, base+"/v1/auth/device/refresh", map[string]string{"refreshToken": credentials.RefreshToken}, nil)
	if err != nil {
		return credentials, err
	}
	if status == http.StatusUnauthorized {
		return credentials, errors.New("credentials are no longer valid; run nwe login")
	}
	if status != http.StatusOK {
		return credentials, fmt.Errorf("refresh failed: HTTP %d", status)
	}
	var rotated struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresIn    int    `json:"expiresIn"`
		Subject      string `json:"subject"`
	}
	if err := json.Unmarshal(payload, &rotated); err != nil || rotated.AccessToken == "" || rotated.RefreshToken == "" {
		return credentials, errors.New("refresh returned unusable credentials")
	}
	credentials.AccessToken = rotated.AccessToken
	credentials.RefreshToken = rotated.RefreshToken
	credentials.Expiry = tokenExpiry(rotated.ExpiresIn)
	if rotated.Subject != "" {
		credentials.Subject = rotated.Subject
	}
	return credentials, saveCredentials(credentials)
}
