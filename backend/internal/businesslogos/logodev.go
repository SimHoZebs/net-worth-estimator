package businesslogos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	logoDevEndpoint    = "https://api.logo.dev/v2/brands/logo"
	logoDevAssetHost   = "img.logo.dev"
	logoDevSize        = 64
	logoDevHTTPTimeout = 20 * time.Second
)

var (
	ErrLogoDevIndexing     = errors.New("logo.dev is still indexing this brand; rerun the import later")
	ErrLogoDevNotFound     = errors.New("logo.dev has no logo for this brand")
	ErrLogoDevUnauthorized = errors.New("logo.dev authentication failed")
	ErrLogoDevForbidden    = errors.New("logo.dev request forbidden")
	ErrLogoDevCredits      = errors.New("logo.dev has insufficient API credits")
	ErrLogoDevRateLimited  = errors.New("logo.dev rate limit reached; rerun the import later")
)

// LogoDevImporter downloads one allowlisted catalog logo at a time. The secret
// key appears only on the JSON API request; signed asset requests have no
// authentication or cookies, and both requests reject redirects.
type LogoDevImporter struct {
	secret string
	client *http.Client
}

func NewLogoDevImporter(secret string, client *http.Client) (*LogoDevImporter, error) {
	if secret == "" || secret != strings.TrimSpace(secret) || strings.ContainsAny(secret, "\r\n") {
		return nil, errors.New("a nonempty LOGO_DEV_SECRET_KEY without surrounding whitespace is required")
	}
	base := http.DefaultClient
	if client != nil {
		base = client
	}
	hardened := *base
	hardened.Jar = nil
	hardened.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if hardened.Timeout <= 0 || hardened.Timeout > logoDevHTTPTimeout {
		hardened.Timeout = logoDevHTTPTimeout
	}
	return &LogoDevImporter{secret: secret, client: &hardened}, nil
}

// Download uses only the canonical public domain from LogoDevDomains. Errors
// omit response bodies, request URLs, the secret key, and signed URLs.
func (i *LogoDevImporter) Download(ctx context.Context, key string) ([]byte, error) {
	domain, ok := LogoDevDomains()[key]
	if !ok {
		return nil, fmt.Errorf("unknown Logo.dev catalog key %q", key)
	}
	query := url.Values{"domain": []string{domain}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, logoDevEndpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, errors.New("could not create the logo.dev API request")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+i.secret)
	response, err := i.client.Do(request)
	if err != nil {
		return nil, logoDevRequestError(ctx, "API")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, logoDevStatusError(response.StatusCode)
	}
	body, err := readLogoDevBody(response.Body)
	if err != nil {
		return nil, fmt.Errorf("logo.dev API response: %w", err)
	}
	var payload struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Data.URL == "" {
		return nil, errors.New("logo.dev returned malformed logo JSON")
	}
	assetURL, err := safeLogoDevAssetURL(payload.Data.URL)
	if err != nil {
		return nil, err
	}

	request, err = http.NewRequestWithContext(ctx, http.MethodGet, assetURL.String(), nil)
	if err != nil {
		return nil, errors.New("could not create the logo.dev asset request")
	}
	request.Header.Set("Accept", pngLogoType)
	response, err = i.client.Do(request)
	if err != nil {
		return nil, logoDevRequestError(ctx, "asset")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, logoDevStatusError(response.StatusCode)
	}
	data, err := readLogoDevBody(response.Body)
	if err != nil {
		return nil, fmt.Errorf("logo.dev asset response: %w", err)
	}
	return normalizeLogoDevPNG(data)
}

func readLogoDevBody(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxLogoBytes+1))
	if err != nil {
		return nil, errors.New("body could not be read")
	}
	if len(data) > maxLogoBytes {
		return nil, fmt.Errorf("body exceeds %d bytes", maxLogoBytes)
	}
	return data, nil
}

func logoDevRequestError(ctx context.Context, stage string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return fmt.Errorf("logo.dev %s request failed", stage)
}

func logoDevStatusError(status int) error {
	switch status {
	case http.StatusAccepted:
		return ErrLogoDevIndexing
	case http.StatusNotFound:
		return ErrLogoDevNotFound
	case http.StatusUnauthorized:
		return ErrLogoDevUnauthorized
	case http.StatusPaymentRequired:
		return ErrLogoDevCredits
	case http.StatusForbidden:
		return ErrLogoDevForbidden
	case http.StatusTooManyRequests:
		return ErrLogoDevRateLimited
	default:
		return fmt.Errorf("logo.dev returned HTTP %d", status)
	}
}

func safeLogoDevAssetURL(raw string) (*url.URL, error) {
	invalid := errors.New("logo.dev returned an unsafe or invalid asset URL")
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != logoDevAssetHost || parsed.User != nil || parsed.Opaque != "" || parsed.Fragment != "" {
		return nil, invalid
	}
	asset, ok := strings.CutPrefix(parsed.EscapedPath(), "/assets/")
	if !ok || asset == "" || asset == "." || asset == ".." || strings.ContainsAny(asset, "/\\%") {
		return nil, invalid
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return nil, invalid
	}
	query.Set("size", strconv.Itoa(logoDevSize))
	query.Set("format", "png")
	parsed.RawQuery = query.Encode()
	return parsed, nil
}

func normalizeLogoDevPNG(data []byte) ([]byte, error) {
	if err := validatePNG(data); err != nil {
		return nil, fmt.Errorf("logo.dev returned an invalid PNG: %w", err)
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("logo.dev returned an invalid PNG")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > logoDevSize || config.Height > logoDevSize {
		return nil, fmt.Errorf("logo.dev PNG dimensions %dx%d exceed the requested %d pixels", config.Width, config.Height, logoDevSize)
	}
	decoded, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("logo.dev returned an invalid PNG")
	}
	var normalized bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(&normalized, decoded); err != nil {
		return nil, errors.New("logo.dev PNG could not be normalized")
	}
	if normalized.Len() > maxLogoBytes {
		return nil, fmt.Errorf("normalized logo.dev PNG exceeds %d bytes", maxLogoBytes)
	}
	return normalized.Bytes(), nil
}
