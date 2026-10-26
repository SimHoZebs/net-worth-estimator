package identity

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// deviceGrantType is the RFC 8628 grant this server enables on its Casdoor
// application. The client secret never leaves the server: CLIs talk only to
// these endpoints, and the server performs every Casdoor exchange.
const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"

// deviceScopes requests a verifiable identity plus a refresh token. The
// audience stays the application client so Bearer principals introspect
// exactly like session grants.
const deviceScopes = "openid profile email offline_access"

type deviceStartResponse struct {
	VerificationURI string `json:"verificationUri"`
	UserCode        string `json:"userCode"`
	DeviceCode      string `json:"deviceCode"`
	ExpiresIn       int    `json:"expiresIn"`
	Interval        int    `json:"interval"`
}

type devicePollRequest struct {
	DeviceCode string `json:"deviceCode"`
}

type deviceTokens struct {
	Status       string `json:"status"`
	Subject      string `json:"subject,omitempty"`
	AccessToken  string `json:"accessToken,omitempty"`
	RefreshToken string `json:"refreshToken,omitempty"`
	ExpiresIn    int    `json:"expiresIn,omitempty"`
}

type deviceRefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func decodeDeviceBody[T any](r *http.Request, value *T) bool {
	if r.Body == nil {
		return false
	}
	defer r.Body.Close()
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(value); err != nil {
		return false
	}
	return true
}

// postDeviceForm performs one provider exchange with the application secret.
// Error bodies stay server-side; callers map failures to fixed messages.
func (s *Service) postDeviceForm(ctx context.Context, endpoint string, form url.Values) (map[string]any, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	request.SetBasicAuth(s.config.ClientID, s.config.ClientSecret)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(&payload); err != nil {
		return nil, response.StatusCode, err
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return payload, response.StatusCode, nil
}

func deviceString(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func deviceInt(payload map[string]any, key string) int {
	switch value := payload[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	default:
		return 0
	}
}

// deviceStart opens one RFC 8628 flow. The CLI shows the verification URI
// and user code; approval happens in the browser on another device.
func (s *Service) deviceStart(w http.ResponseWriter, r *http.Request) {
	if s.deviceAuth == "" {
		failure(w, 503, "Device sign-in is not available from this provider.")
		return
	}
	payload, status, err := s.postDeviceForm(r.Context(), s.deviceAuth, url.Values{
		"client_id": {s.config.ClientID},
		"scope":     {deviceScopes},
	})
	if err != nil || status != http.StatusOK {
		failure(w, 503, "The provider did not start device sign-in. Retry this request.")
		return
	}
	out := deviceStartResponse{
		VerificationURI: deviceString(payload, "verification_uri"),
		UserCode:        deviceString(payload, "user_code"),
		DeviceCode:      deviceString(payload, "device_code"),
		ExpiresIn:       deviceInt(payload, "expires_in"),
		Interval:        deviceInt(payload, "interval"),
	}
	if out.VerificationURI == "" || out.UserCode == "" || out.DeviceCode == "" {
		failure(w, 503, "The provider did not start device sign-in. Retry this request.")
		return
	}
	respond(w, out)
}

// devicePoll checks one open flow. Pending approvals return 200 with a
// pending status so the CLI keeps polling; terminal states are explicit.
func (s *Service) devicePoll(w http.ResponseWriter, r *http.Request) {
	var input devicePollRequest
	if !decodeDeviceBody(r, &input) || input.DeviceCode == "" {
		failure(w, 400, "A device code is required to check device sign-in.")
		return
	}
	payload, status, err := s.postDeviceForm(r.Context(), s.oauth.Endpoint.TokenURL, url.Values{
		"grant_type":  {deviceGrantType},
		"device_code": {input.DeviceCode},
		"client_id":   {s.config.ClientID},
	})
	if err != nil || status != http.StatusOK {
		code := deviceString(payload, "error")
		switch code {
		case "authorization_pending", "slow_down":
			respond(w, deviceTokens{Status: "pending"})
			return
		case "expired_token":
			failure(w, 410, "Device sign-in expired. Start again.")
			return
		case "access_denied":
			failure(w, 403, "Device sign-in was declined.")
			return
		}
		failure(w, 503, "The provider did not complete device sign-in. Retry this request.")
		return
	}
	s.respondDeviceTokens(w, r, payload)
}

// deviceRefresh rotates credentials without browser interaction. The CLI
// holds tokens; the server holds the secret that makes refresh possible.
func (s *Service) deviceRefresh(w http.ResponseWriter, r *http.Request) {
	var input deviceRefreshRequest
	if !decodeDeviceBody(r, &input) || input.RefreshToken == "" {
		failure(w, 400, "A refresh token is required to rotate device credentials.")
		return
	}
	payload, status, err := s.postDeviceForm(r.Context(), s.oauth.Endpoint.TokenURL, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {input.RefreshToken},
		"client_id":     {s.config.ClientID},
	})
	if err != nil || status != http.StatusOK {
		if deviceString(payload, "error") == "invalid_grant" {
			failure(w, 401, "Device credentials are no longer valid. Sign in again.")
			return
		}
		failure(w, 503, "The provider did not rotate device credentials. Retry this request.")
		return
	}
	s.respondDeviceTokens(w, r, payload)
}

// respondDeviceTokens validates minted tokens before handing them out so
// the CLI never receives credentials this server would reject.
func (s *Service) respondDeviceTokens(w http.ResponseWriter, r *http.Request, payload map[string]any) {
	accessToken := deviceString(payload, "access_token")
	if accessToken == "" {
		failure(w, 503, "The provider did not complete device sign-in. Retry this request.")
		return
	}
	result, err := s.postIntrospection(r.Context(), accessToken)
	if err != nil || result.Subject == "" || result.ClientID != s.config.ClientID || result.Issuer != s.config.Issuer || !audienceMatches(result.Audience, s.config.ClientID) {
		failure(w, 503, "The provider did not complete device sign-in. Retry this request.")
		return
	}
	refreshToken := deviceString(payload, "refresh_token")
	if refreshToken == "" {
		failure(w, 503, "The provider did not complete device sign-in. Retry this request.")
		return
	}
	respond(w, deviceTokens{
		Status:       "complete",
		Subject:      result.Subject,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    deviceInt(payload, "expires_in"),
	})
}
