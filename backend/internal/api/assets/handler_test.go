package assets

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/memory"
	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
)

func testHandler(t *testing.T) (http.Handler, *memory.Store) {
	t.Helper()
	store := memory.New()
	service, err := businesslogos.New(store)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Seed(context.Background()); err != nil {
		t.Fatal(err)
	}
	return NewHandler(service), store
}

func request(h http.Handler, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	for key, value := range headers {
		r.Header.Set(key, value)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestStablePathRedirectsToImmutableVersion(t *testing.T) {
	h, _ := testHandler(t)
	asset, _ := businesslogos.Lookup("chase")
	w := request(h, http.MethodGet, businesslogos.PathPrefix+"chase", nil)
	if w.Code != http.StatusFound {
		t.Fatalf("stable path = %d %q", w.Code, w.Body.String())
	}
	if want := businesslogos.PathPrefix + "chase/" + asset.Version; w.Header().Get("Location") != want {
		t.Fatalf("location = %q, want %q", w.Header().Get("Location"), want)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("stable cache = %q", got)
	}
	if w.Header().Get("ETag") != `"`+asset.SHA256+`"` {
		t.Fatalf("stable ETag = %q", w.Header().Get("ETag"))
	}
}

func TestVersionedCatalogAsset(t *testing.T) {
	h, _ := testHandler(t)
	asset, _ := businesslogos.Lookup("venmo")
	path := businesslogos.PathPrefix + "venmo/" + asset.Version
	w := request(h, http.MethodGet, path, nil)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("versioned = %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	if got := w.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("immutable cache = %q", got)
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	if w.Header().Get("ETag") != `"`+asset.SHA256+`"` {
		t.Fatalf("ETag = %q", w.Header().Get("ETag"))
	}
	if w.Header().Get("Content-Length") != strconv.FormatInt(asset.Size, 10) {
		t.Fatalf("content length = %q", w.Header().Get("Content-Length"))
	}
	if int64(w.Body.Len()) != asset.Size || !bytes.HasPrefix(w.Body.Bytes(), []byte("<svg")) || !bytes.HasSuffix(w.Body.Bytes(), []byte("</svg>")) {
		t.Fatalf("unexpected SVG body: %d bytes", w.Body.Len())
	}

	cached := request(h, http.MethodGet, path, map[string]string{"If-None-Match": `"` + asset.SHA256 + `"`})
	if cached.Code != http.StatusNotModified || cached.Body.Len() != 0 {
		t.Fatalf("conditional GET = %d %d", cached.Code, cached.Body.Len())
	}
	if cached.Header().Get("Cache-Control") != w.Header().Get("Cache-Control") {
		t.Fatal("conditional response lost immutable cache")
	}

	head := request(h, http.MethodHead, path, nil)
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("HEAD = %d %d", head.Code, head.Body.Len())
	}
}

func TestCatalogOnlyBoundaries(t *testing.T) {
	h, store := testHandler(t)
	// A private-looking object in the same store is never addressable.
	if err := store.Put(context.Background(), "receipt-secret", strings.NewReader("private"), 7); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		businesslogos.PathPrefix + "receipt-secret",
		businesslogos.PathPrefix + "receipt-secret/deadbeef",
		businesslogos.PathPrefix + "chase/deadbeef",
		businesslogos.PathPrefix + "../receipt-secret",
		businesslogos.PathPrefix + "chase/../../receipt-secret",
		businesslogos.PathPrefix,
	} {
		w := request(h, http.MethodGet, path, nil)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s = %d", path, w.Code)
		}
		if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s missing defensive headers", path)
		}
	}
	if w := request(h, http.MethodPost, businesslogos.PathPrefix+"chase", nil); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d", w.Code)
	}
}

func TestReadFailureIsNotServed(t *testing.T) {
	h, store := testHandler(t)
	asset, _ := businesslogos.Lookup("klarna")
	if err := store.Delete(context.Background(), asset.ObjectKey); err != nil {
		t.Fatal(err)
	}
	w := request(h, http.MethodGet, businesslogos.PathPrefix+"klarna/"+asset.Version, nil)
	if w.Code != http.StatusInternalServerError || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("ETag") != "" {
		t.Fatalf("read failure = %d %v", w.Code, w.Header())
	}
}
