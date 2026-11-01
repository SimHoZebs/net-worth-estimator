// Package sharing serves cross-user transaction authorization over HTTP
// (FND-02). Grants name one owner-scoped posting and one audience and are
// issued only by the source owner for their own postings: the owner is
// always the authenticated caller, so a group administrator cannot grant
// for another member. Reads re-evaluate current membership, exclusion,
// and revocation state in the store on every call.
//
// Status contract mirrors groups: unknown postings, owners, or memberships
// report 404 (store.ErrNotFound), including reads by unauthorized callers
// so shared data is not enumerable. Denied member actions report 403
// (store.ErrGroupForbidden). Rejected input reports 400
// (store.ErrGroupInvalid, message safe to show), and anything else reports
// 503 without leaking internals.
//
// Reads return the existing transaction shape only. There is no
// cross-user account, balance, model, secret, or receipt path here, and
// no delegated write path for another member's original: writes to a
// source original stay deferred, so non-GET methods on the read path
// report 405.
//
// Recipient-owned copies (SOC-02) expose their FND-04 link provenance at
// /v1/shared/copies/{copyId}/link (a read of the recipient's own memory,
// allowed in read-only mode) and a refresh at
// /v1/shared/copies/{copyId}/refresh that re-checks live authorization
// and source state. Refresh records its outcome on the link row and never
// rewrites the copy, so source changes surface only while authorized and
// the copy survives revocation.
package sharing

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Config carries transport policy shared with the plan API. Sharing obeys
// the global read-only kill switch: no exemption.
type Config struct {
	AllowedOrigins []string
	ReadOnly       bool
}

// Handler routes sharing requests. The identity middleware supplies Principal.
type Handler struct {
	db       store.Database
	issuer   string
	readOnly bool
	origins  []string
}

func New(db store.Database, issuer string, config Config) *Handler {
	return &Handler{db: db, issuer: issuer, readOnly: config.ReadOnly, origins: config.AllowedOrigins}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/shared/grants", h.serveGrants)
	mux.HandleFunc("/v1/shared/exclusions", h.serveExclusions)
	mux.HandleFunc("/v1/shared/copies", h.serveCopies)
	mux.HandleFunc("/v1/shared/copies/", h.serveCopyLink)
	mux.HandleFunc("/v1/shared/postings", h.serveSharedList)
	mux.HandleFunc("/v1/shared/postings/", h.serveSharedRead)
	return middleware.Recoverer(api.CORSMiddleware(h.origins)(mux))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeProblem(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "title": http.StatusText(status), "detail": detail})
}

// writeStoreError maps store results to the status contract. Validation
// messages are safe to show; anything else becomes a generic 503 without
// internals. Denied and missing reads both map to 404 upstream: the store
// reports ErrNotFound for either so existence is not enumerable.
func writeStoreError(w http.ResponseWriter, err error, notFound string) {
	switch {
	case err == nil:
		return
	case errors.Is(err, store.ErrGroupForbidden):
		writeProblem(w, http.StatusForbidden, "This action is not permitted for shared transactions.")
	case errors.Is(err, store.ErrNotFound), store.IsNotFound(err):
		writeProblem(w, http.StatusNotFound, notFound)
	case errors.Is(err, store.ErrGroupInvalid):
		writeProblem(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "invalid group request: "))
	default:
		writeProblem(w, http.StatusServiceUnavailable, "Shared transaction storage is temporarily unavailable.")
	}
}

func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return io.ReadAll(r.Body)
}

// caller resolves the authenticated subject to its stable user ID. It is
// always the source owner for grant paths: there is no owner field to
// forge because the owner is never read from the request.
func (h *Handler) caller(r *http.Request) (string, string, bool) {
	subject := identity.Subject(r.Context())
	if subject == "" {
		return "", "", false
	}
	user, err := h.db.EnsureGroupUser(h.issuer, subject)
	if err != nil {
		return "", "", false
	}
	return user, subject, true
}

// locked rejects state-changing requests while the server is read-only,
// mirroring the plan API kill switch.
func (h *Handler) locked(w http.ResponseWriter, r *http.Request) bool {
	if h.readOnly {
		writeProblem(w, http.StatusForbidden, "The server is read-only. Sharing cannot be changed right now.")
		return true
	}
	return false
}

type grantInput struct {
	PostingID    string `json:"postingId"`
	AudienceType string `json:"audienceType"`
	AudienceID   string `json:"audienceId"`
}

func decodeGrantInput(body []byte) (grantInput, error) {
	var input grantInput
	if err := json.Unmarshal(body, &input); err != nil {
		return grantInput{}, err
	}
	input.PostingID = strings.TrimSpace(input.PostingID)
	input.AudienceType = strings.TrimSpace(input.AudienceType)
	input.AudienceID = strings.TrimSpace(input.AudienceID)
	return input, nil
}

func (h *Handler) serveGrants(w http.ResponseWriter, r *http.Request) {
	owner, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to share transactions.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		grants, err := h.db.ListSharingGrants(owner)
		if err != nil {
			writeStoreError(w, err, "Shared transactions not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"grants": grants})
	case http.MethodPost:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		input, err := decodeGrantInput(body)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		grant, err := h.db.GrantSharedPosting(owner, input.PostingID, input.AudienceType, input.AudienceID)
		if err != nil {
			writeStoreError(w, err, "Transaction not found.")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"grant": grant})
	case http.MethodDelete:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		input, err := decodeGrantInput(body)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		if err := h.db.RevokeSharedPosting(owner, input.PostingID, input.AudienceType, input.AudienceID); err != nil {
			writeStoreError(w, err, "Grant not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"revoked": input.PostingID})
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

func (h *Handler) serveExclusions(w http.ResponseWriter, r *http.Request) {
	owner, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to share transactions.")
		return
	}
	switch r.Method {
	case http.MethodPost:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		input, err := decodeGrantInput(body)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		exclusion, err := h.db.ExcludeSharedPosting(owner, input.PostingID, input.AudienceType, input.AudienceID)
		if err != nil {
			writeStoreError(w, err, "Transaction not found.")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"exclusion": exclusion})
	case http.MethodDelete:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		input, err := decodeGrantInput(body)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		if err := h.db.RemoveSharedExclusion(owner, input.PostingID, input.AudienceType, input.AudienceID); err != nil {
			writeStoreError(w, err, "Exclusion not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"removed": input.PostingID})
	default:
		w.Header().Set("Allow", "POST, DELETE")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

func (h *Handler) serveSharedList(w http.ResponseWriter, r *http.Request) {
	requester, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to view shared transactions.")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	refs, err := h.db.ListSharedPostings(requester)
	if err != nil {
		writeStoreError(w, err, "Shared transactions not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"shared": refs})
}

// serveSharedRead returns one authorized posting in the existing
// transaction shape. The owner segment uses the user-resource form
// (users/<64hex>) matching Waypoint-Resource values; anything else,
// including forged owner IDs, reports 404.
func (h *Handler) serveSharedRead(w http.ResponseWriter, r *http.Request) {
	requester, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to view shared transactions.")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeProblem(w, http.StatusMethodNotAllowed, "Editing another member's original transaction is deferred; shared originals are read-only.")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/shared/postings/")
	parts := strings.SplitN(rest, "/", 3)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" || strings.Contains(parts[2], "/") {
		writeProblem(w, http.StatusNotFound, "Shared transaction not found.")
		return
	}
	owner, err := resourceOwner(parts[0] + "/" + parts[1])
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Shared transaction not found.")
		return
	}
	posting, err := h.db.ReadSharedPosting(owner, parts[2], requester)
	if err != nil {
		writeStoreError(w, err, "Shared transaction not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ownerUserId": owner, "posting": posting})
}

func (h *Handler) serveCopies(w http.ResponseWriter, r *http.Request) {
	requester, subject, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to accept shared transactions.")
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	if h.locked(w, r) {
		return
	}
	body, err := readBody(w, r, 1<<16)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
		return
	}
	var input struct {
		Owner     string `json:"owner"`
		PostingID string `json:"postingId"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
		return
	}
	owner, err := resourceOwner(strings.TrimSpace(input.Owner))
	if err != nil || strings.TrimSpace(input.PostingID) == "" {
		writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
		return
	}
	// Accepting seeds the recipient's private model when this is their
	// first financial access, mirroring first-authorized-access
	// provisioning. Copies are ordinary recipient rows afterwards.
	if _, err := h.db.EnsureUser(requester, h.issuer, subject); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Shared transaction storage is temporarily unavailable.")
		return
	}
	copied, err := h.db.CopySharedPosting(owner, strings.TrimSpace(input.PostingID), requester)
	if err != nil {
		writeStoreError(w, err, "Shared transaction not found.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"posting": copied})
}

// serveCopyLink serves one recipient-owned copy's link provenance. The
// link is the recipient's own memory: resolving it performs no source
// authorization check, so it stays readable after revocation. Refresh
// re-checks live authorization and records the outcome on the link row;
// it never writes the copy, so recipient edits survive every outcome
// and source changes surface only while authorized. Refresh mutates the
// link row, so it obeys the read-only kill switch; the link read does
// not. Unknown, foreign, and malformed copy IDs all report 404 so link
// memory is never enumerable across users.
func (h *Handler) serveCopyLink(w http.ResponseWriter, r *http.Request) {
	recipient, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to view shared transactions.")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/shared/copies/")
	copyID, action, found := strings.Cut(rest, "/")
	if !found || copyID == "" || action == "" || strings.Contains(action, "/") {
		writeProblem(w, http.StatusNotFound, "Shared transaction link not found.")
		return
	}
	switch action {
	case "link":
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
			return
		}
		link, err := h.db.GetSharingLink(recipient, copyID)
		if err != nil {
			writeStoreError(w, err, "Shared transaction link not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"link": link})
	case "refresh":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
			return
		}
		if h.locked(w, r) {
			return
		}
		refreshed, err := h.db.RefreshSharingLink(recipient, copyID)
		if err != nil {
			writeStoreError(w, err, "Shared transaction link not found.")
			return
		}
		writeJSON(w, http.StatusOK, refreshed)
	default:
		writeProblem(w, http.StatusNotFound, "Shared transaction link not found.")
	}
}

// resourceOwner converts the user-resource form (users/<64hex>) used by
// Waypoint-Resource headers into the store user ID (user:<hex>). Browser
// fields never supply a store ID directly.
func resourceOwner(resource string) (string, error) {
	hash, ok := strings.CutPrefix(resource, "users/")
	if !ok || len(hash) != 64 {
		return "", errors.New("shared owner must be a user resource")
	}
	for _, c := range hash {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return "", errors.New("shared owner must be a user resource")
		}
	}
	return "user:" + hash, nil
}
