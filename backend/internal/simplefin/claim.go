package simplefin

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ClaimUsedError reports that a setup token was rejected: it is invalid,
// expired, or already claimed. The token may be compromised, so callers
// surface this distinctly and never retry the same token.
type ClaimUsedError struct {
	Host string
}

func (e *ClaimUsedError) Error() string {
	if e.Host != "" {
		return fmt.Sprintf("simplefin setup token was rejected by %s; it may have been used already", e.Host)
	}
	return "simplefin setup token was rejected; it may have been used already"
}

// DecodeSetupToken decodes a pasted SimpleFIN setup token into the claim URL.
// The token is base64 of an https URL. Only the host is kept for errors.
func DecodeSetupToken(token string) (*url.URL, error) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return nil, fmt.Errorf("simplefin setup token is empty")
	}
	// Accept both standard and URL-safe base64; users paste from clipboards
	// that may strip padding.
	raw := strings.TrimSpace(trimmed)
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		// Try without padding, then raw URL encoding.
		if padded := raw + strings.Repeat("=", (4-len(raw)%4)%4); padded != raw {
			if retry, retryErr := base64.StdEncoding.DecodeString(padded); retryErr == nil {
				decoded = retry
				err = nil
			}
		}
	}
	if err != nil {
		if unpadded, rawErr := base64.RawStdEncoding.DecodeString(raw); rawErr == nil {
			decoded = unpadded
			err = nil
		} else if urlDecoded, urlErr := base64.URLEncoding.DecodeString(raw); urlErr == nil {
			decoded = urlDecoded
			err = nil
		} else if urlRaw, urlRawErr := base64.RawURLEncoding.DecodeString(raw); urlRawErr == nil {
			decoded = urlRaw
			err = nil
		}
	}
	if err != nil {
		return nil, fmt.Errorf("simplefin setup token is not valid base64")
	}
	claimURL, err := url.Parse(strings.TrimSpace(string(decoded)))
	if err != nil || claimURL.Host == "" {
		return nil, fmt.Errorf("simplefin setup token does not decode to a URL")
	}
	if !strings.EqualFold(claimURL.Scheme, "https") {
		return nil, fmt.Errorf("simplefin setup token must use https")
	}
	if claimURL.User != nil {
		return nil, fmt.Errorf("simplefin setup token URL must not embed credentials")
	}
	return claimURL, nil
}

// ParseAccessURL validates a directly pasted Bridge Access URL. It must be
// an https URL with a host.
func ParseAccessURL(accessURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(accessURL)
	if trimmed == "" {
		return nil, fmt.Errorf("simplefin access URL is empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("simplefin access URL is not a valid URL")
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return nil, fmt.Errorf("simplefin access URL must use https")
	}
	return parsed, nil
}

// BridgeHost returns the host of an access URL for display, never the secret.
func BridgeHost(accessURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(accessURL))
	if err != nil {
		return ""
	}
	return parsed.Host
}

// ClaimAccessURL exchanges a decoded claim URL for a Bridge Access URL with
// a single POST. The response body is the Access URL text. Errors carry only
// the Bridge host: transport errors are unwrapped from *url.Error so the
// single-use claim path never reaches logs or API responses.
func ClaimAccessURL(ctx context.Context, httpClient *http.Client, claimURL *url.URL) (string, error) {
	client := httpClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, claimURL.String(), nil)
	if err != nil {
		return "", fmt.Errorf("simplefin claim request to %s failed", claimURL.Host)
	}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("simplefin claim to %s: %w", claimURL.Host, redactClaimError(err))
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	if err != nil {
		return "", fmt.Errorf("simplefin claim read from %s: %w", claimURL.Host, err)
	}
	if response.StatusCode == http.StatusForbidden {
		return "", &ClaimUsedError{Host: claimURL.Host}
	}
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("simplefin claim to %s: status %d", claimURL.Host, response.StatusCode)
	}
	accessURL := strings.TrimSpace(string(body))
	if _, err := ParseAccessURL(accessURL); err != nil {
		return "", fmt.Errorf("simplefin claim from %s returned an invalid access URL", claimURL.Host)
	}
	return accessURL, nil
}

// redactClaimError unwraps *url.Error so the single-use claim path never
// reaches logs or API responses; only the host is reported by callers.
func redactClaimError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Err != nil {
		return urlErr.Err
	}
	return err
}
