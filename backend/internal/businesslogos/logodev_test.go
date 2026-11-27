package businesslogos

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
)

type logoDevRoundTripFunc func(*http.Request) (*http.Response, error)

func (function logoDevRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func logoDevResponse(request *http.Request, status int, body []byte) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), Request: request}
}

func logoDevJSON(assetURL string) []byte {
	return []byte(`{"data":{"url":"` + assetURL + `"}}`)
}

func logoDevTestPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	img.SetNRGBA(1, 1, color.NRGBA{R: 17, G: 29, B: 0x5a, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func addLogoDevMetadata(t *testing.T, data []byte) []byte {
	t.Helper()
	text := "private-metadata-to-remove"
	chunk := make([]byte, 12+len(text))
	binary.BigEndian.PutUint32(chunk[:4], uint32(len(text)))
	copy(chunk[4:8], "tEXt")
	copy(chunk[8:], text)
	binary.BigEndian.PutUint32(chunk[8+len(text):], crc32.ChecksumIEEE(chunk[4:8+len(text)]))
	return append(append(append([]byte(nil), data[:33]...), chunk...), data[33:]...)
}

func TestLogoDevAllowlistedDomainAndAuthenticationBoundary(t *testing.T) {
	const secret = "sk_controlled-secret"
	const signature = "controlled-signed-secret"
	signedURL := "https://img.logo.dev/assets/sealed-token?signature=" + signature
	input := addLogoDevMetadata(t, logoDevTestPNG(t, 8, 4))
	var requests []*http.Request
	client := &http.Client{Transport: logoDevRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests = append(requests, request)
		if len(requests) == 1 {
			if request.Method != http.MethodGet || request.URL.String() != "https://api.logo.dev/v2/brands/logo?domain=amazon.com" {
				t.Errorf("API request = %s %s", request.Method, request.URL)
			}
			if request.Header.Get("Authorization") != "Bearer "+secret || request.Body != nil {
				t.Errorf("API request carried unexpected credentials or data: %v", request)
			}
			return logoDevResponse(request, http.StatusOK, logoDevJSON(signedURL)), nil
		}
		if request.URL.Scheme != "https" || request.URL.Host != logoDevAssetHost || request.URL.Path != "/assets/sealed-token" {
			t.Errorf("asset request = %s", request.URL)
		}
		query := request.URL.Query()
		if query.Get("size") != "64" || query.Get("format") != "png" || query.Get("signature") != signature {
			t.Errorf("asset query = %v", query)
		}
		if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" || strings.Contains(request.URL.String(), secret) {
			t.Errorf("asset request leaked API authentication: %v", request)
		}
		return logoDevResponse(request, http.StatusOK, input), nil
	})}
	importer, err := NewLogoDevImporter(secret, client)
	if err != nil {
		t.Fatal(err)
	}
	result, err := importer.Download(context.Background(), "amazon")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := importer.Download(context.Background(), "../amazon"); err == nil {
		t.Fatal("unknown key was accepted")
	}
	if len(requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(requests))
	}
	if err := validatePNG(result); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(result, []byte("private-metadata-to-remove")) {
		t.Fatal("normalized PNG retained metadata")
	}
	decoded, err := png.Decode(bytes.NewReader(result))
	if err != nil {
		t.Fatal(err)
	}
	if got := decoded.Bounds().Size(); got.X != 8 || got.Y != 4 {
		t.Fatalf("dimensions = %v", got)
	}
	want := color.NRGBA{R: 17, G: 29, B: 0x5a, A: 0xff}
	if got := color.NRGBAModel.Convert(decoded.At(1, 1)).(color.NRGBA); got != want {
		t.Fatalf("pixel = %+v, want %+v", got, want)
	}
}

func TestLogoDevAccountStatusesStopWithoutRetry(t *testing.T) {
	for _, test := range []struct {
		status int
		want   error
	}{
		{http.StatusAccepted, ErrLogoDevIndexing},
		{http.StatusNotFound, ErrLogoDevNotFound},
		{http.StatusUnauthorized, ErrLogoDevUnauthorized},
		{http.StatusPaymentRequired, ErrLogoDevCredits},
		{http.StatusForbidden, ErrLogoDevForbidden},
		{http.StatusTooManyRequests, ErrLogoDevRateLimited},
	} {
		t.Run(http.StatusText(test.status), func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: logoDevRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				return logoDevResponse(request, test.status, []byte(`{"error":{"message":"must not be reported"}}`)), nil
			})}
			importer, err := NewLogoDevImporter("sk_status-secret", client)
			if err != nil {
				t.Fatal(err)
			}
			_, err = importer.Download(context.Background(), "amazon")
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			if calls != 1 {
				t.Fatalf("requests = %d, want one attempt", calls)
			}
			if strings.Contains(err.Error(), "sk_status-secret") || strings.Contains(err.Error(), "must not be reported") {
				t.Fatalf("error leaked response or credential data: %v", err)
			}
		})
	}
}

func TestLogoDevRejectsUnsafeAssetsAndRedirects(t *testing.T) {
	for _, assetURL := range []string{
		"http://img.logo.dev/assets/token",
		"https://img.logo.dev.evil.example/assets/token",
		"https://img.logo.dev/not-assets/token",
		"https://img.logo.dev/assets/%2Ftoken",
	} {
		t.Run(assetURL, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: logoDevRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				return logoDevResponse(request, http.StatusOK, logoDevJSON(assetURL)), nil
			})}
			importer, err := NewLogoDevImporter("sk_url-secret", client)
			if err != nil {
				t.Fatal(err)
			}
			_, err = importer.Download(context.Background(), "amazon")
			if err == nil || calls != 1 {
				t.Fatalf("error = %v, requests = %d", err, calls)
			}
			if strings.Contains(err.Error(), assetURL) {
				t.Fatalf("error echoed the asset URL: %v", err)
			}
		})
	}

	t.Run("asset redirect", func(t *testing.T) {
		const signedURL = "https://img.logo.dev/assets/redirect-token?signature=redirect-secret"
		calls := 0
		client := &http.Client{Transport: logoDevRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			calls++
			if calls == 1 {
				return logoDevResponse(request, http.StatusOK, logoDevJSON(signedURL)), nil
			}
			response := logoDevResponse(request, http.StatusFound, nil)
			response.Header.Set("Location", "https://attacker.example/collect")
			return response, nil
		})}
		importer, err := NewLogoDevImporter("sk_redirect-secret", client)
		if err != nil {
			t.Fatal(err)
		}
		_, err = importer.Download(context.Background(), "amazon")
		if err == nil || calls != 2 {
			t.Fatalf("error = %v, requests = %d", err, calls)
		}
		if strings.Contains(err.Error(), signedURL) || strings.Contains(err.Error(), "attacker.example") {
			t.Fatalf("error leaked a request URL: %v", err)
		}
	})
}

func TestLogoDevRejectsMalformedOversizeAndWrongSizedPNGs(t *testing.T) {
	for _, test := range []struct {
		name string
		body []byte
	}{
		{"malformed", []byte("not a PNG")},
		{"oversize", bytes.Repeat([]byte("x"), maxLogoBytes+1)},
		{"wrong size", logoDevTestPNG(t, logoDevSize+1, 1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: logoDevRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				if calls == 1 {
					return logoDevResponse(request, http.StatusOK, logoDevJSON("https://img.logo.dev/assets/invalid?signature=signed-secret")), nil
				}
				return logoDevResponse(request, http.StatusOK, test.body), nil
			})}
			importer, err := NewLogoDevImporter("sk_asset-secret", client)
			if err != nil {
				t.Fatal(err)
			}
			result, err := importer.Download(context.Background(), "amazon")
			if err == nil || result != nil || calls != 2 {
				t.Fatalf("result = %d bytes, error = %v, requests = %d", len(result), err, calls)
			}
			if strings.Contains(err.Error(), "signed-secret") || strings.Contains(err.Error(), "img.logo.dev") {
				t.Fatalf("error leaked the signed URL: %v", err)
			}
		})
	}
}
