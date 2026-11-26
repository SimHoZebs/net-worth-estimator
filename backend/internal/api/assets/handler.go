// Package assets serves curated business logos from a catalog-only asset
// service. It exposes no object keys, user data, or general storage access.
package assets

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
)

const immutableCache = "public, max-age=31536000, immutable"

// Handler resolves only manifest keys to manifest assets. Requests are GET or
// HEAD; the versioned path is immutable and the stable path redirects to it.
type Handler struct {
	service *businesslogos.Service
}

func NewHandler(service *businesslogos.Service) http.Handler {
	return &Handler{service: service}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	key, version, ok := parsePath(r.URL.Path)
	if !ok || h.service == nil {
		notFound(w, r)
		return
	}
	asset, known := businesslogos.Lookup(key)
	if !known || (version != "" && version != asset.Version) {
		notFound(w, r)
		return
	}
	etag := `"` + asset.SHA256 + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if version == "" {
		// Revalidate the stable path so an updated catalog hash is discovered;
		// the redirect target is cached forever and never changes its bytes.
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Location", businesslogos.PathPrefix+key+"/"+asset.Version)
		w.WriteHeader(http.StatusFound)
		return
	}
	w.Header().Set("Cache-Control", immutableCache)
	w.Header().Set("Content-Type", asset.ContentType)
	if asset.LicenseURL != "" {
		w.Header().Set("Link", `<`+asset.LicenseURL+`>; rel="license"`)
	}
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	reader, served, err := h.service.Open(r.Context(), key)
	if err != nil {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Del("ETag")
		http.Error(w, "Logo is temporarily unavailable", http.StatusInternalServerError)
		return
	}
	defer reader.Close()
	w.Header().Set("Content-Length", strconv.FormatInt(served.Size, 10))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = io.Copy(w, reader)
	}
}

func parsePath(path string) (key, version string, ok bool) {
	if !strings.HasPrefix(path, businesslogos.PathPrefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, businesslogos.PathPrefix), "/")
	if len(parts) < 1 || len(parts) > 2 {
		return "", "", false
	}
	if parts[0] == "" || !businesslogos.IsCatalogKey(parts[0]) {
		return "", "", false
	}
	if len(parts) == 2 && parts[1] == "" {
		return "", "", false
	}
	if len(parts) == 1 {
		return parts[0], "", true
	}
	return parts[0], parts[1], true
}

func notFound(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	http.Error(w, "Unknown business logo", http.StatusNotFound)
}
