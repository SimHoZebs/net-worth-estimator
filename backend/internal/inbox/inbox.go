// Package inbox serves the received-share inbox over HTTP (FND-03): one
// place for transaction shares the caller received through FND-02 grants.
// Items derive from the ListSharedTransactions primitive; inbox rows only
// record the recipient's own decision, read, and dismissed state and
// never authorize. Previews appear only while the recipient is currently
// authorized; revoked shares surface as canceled without content.
//
// Status contract mirrors sharing: unknown or unauthorized shares report
// 404 (store.ErrNotFound) so shared data is not enumerable. Rejected
// input reports 400 (store.ErrGroupInvalid, message safe to show), and
// anything else reports 503 without leaking internals.
//
// Split requests (SOC-03 assigned shares, SOC-04C split builder) surface
// through the same item envelope with kind "split-request" once those
// producers land; this package serves the "share" kind. See the producer
// contract in docs/authorization.md.
package inbox

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Config carries transport policy shared with the plan API. The inbox
// obeys the global read-only kill switch: no exemption.
type Config struct {
	AllowedOrigins []string
	ReadOnly       bool
}

// Handler routes inbox requests. The identity middleware supplies Principal.
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
	mux.HandleFunc("/v1/inbox", h.serveInbox)
	mux.HandleFunc("/v1/inbox/shares/accept", h.serveAccept)
	mux.HandleFunc("/v1/inbox/shares/decline", h.serveDecline)
	mux.HandleFunc("/v1/inbox/shares/dismiss", h.serveDismiss)
	mux.HandleFunc("/v1/inbox/shares/read", h.serveRead)
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
// internals. Missing and denied shares both map to 404 upstream: the
// store reports ErrNotFound for either so existence is not enumerable.
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

// caller resolves the authenticated subject to its stable user ID.
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
		writeProblem(w, http.StatusForbidden, "The server is read-only. The inbox cannot be changed right now.")
		return true
	}
	return false
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

type shareInput struct {
	Owner         string `json:"owner"`
	TransactionID string `json:"transactionId"`
}

func decodeShareInput(body []byte) (owner, transactionID string, ok bool) {
	var input shareInput
	if err := json.Unmarshal(body, &input); err != nil {
		return "", "", false
	}
	owner, err := resourceOwner(strings.TrimSpace(input.Owner))
	if err != nil {
		return "", "", false
	}
	transactionID = strings.TrimSpace(input.TransactionID)
	if transactionID == "" {
		return "", "", false
	}
	return owner, transactionID, true
}

// serveInbox lists the recipient's received shares, newest first. The
// status filter names one of pending, accepted, declined, canceled, or
// all (default pending); dismissed items leave the list unless
// showDismissed=1. unreadCount covers every unread non-dismissed item so
// the badge survives tab switches.
func (h *Handler) serveInbox(w http.ResponseWriter, r *http.Request) {
	recipient, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to view your inbox.")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status == "" {
		status = store.InboxStatusPending
	}
	switch status {
	case store.InboxStatusPending, store.InboxStatusAccepted, store.InboxStatusDeclined, store.InboxStatusCanceled, "all":
	default:
		writeProblem(w, http.StatusBadRequest, "The inbox filter is invalid.")
		return
	}
	showDismissed := r.URL.Query().Get("showDismissed") == "1" || strings.EqualFold(r.URL.Query().Get("showDismissed"), "true")
	countOnly := r.URL.Query().Get("countOnly") == "1" || strings.EqualFold(r.URL.Query().Get("countOnly"), "true")
	items, err := h.db.ListInboxItems(recipient)
	if err != nil {
		writeStoreError(w, err, "Inbox not found.")
		return
	}
	unread := 0
	filtered := []store.InboxShareItem{}
	for _, item := range items {
		if item.Unread && !item.Dismissed {
			unread++
		}
		if item.Dismissed && !showDismissed {
			continue
		}
		if status != "all" && item.Status != status {
			continue
		}
		filtered = append(filtered, item)
	}
	if countOnly {
		// The badge asks one question. Do not serialize the item list for it.
		writeJSON(w, http.StatusOK, map[string]any{"unreadCount": unread})
		return
	}
	sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].ReceivedAt > filtered[j].ReceivedAt })
	writeJSON(w, http.StatusOK, map[string]any{"items": filtered, "unreadCount": unread})
}

// serveAccept records acceptance and saves one personal copy. Retries
// return the recorded item without minting another copy.
func (h *Handler) serveAccept(w http.ResponseWriter, r *http.Request) {
	recipient, subject, ok := h.caller(r)
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
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	owner, transactionID, ok := decodeShareInput(body)
	if !ok {
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	// Accepting seeds the recipient's private model when this is their
	// first financial access, mirroring the shared-copies path. Copies
	// are ordinary recipient rows afterwards.
	if _, err := h.db.EnsureUser(recipient, h.issuer, subject); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Shared transaction storage is temporarily unavailable.")
		return
	}
	item, err := h.db.AcceptInboxShare(recipient, owner, transactionID)
	if err != nil {
		writeStoreError(w, err, "Shared transaction not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

// serveDecline records the refusal and withdraws the recipient's own
// direct grant, so they leave the sender's sharing list. Group-audience
// shares keep their grant and the refusal stays recipient-local.
func (h *Handler) serveDecline(w http.ResponseWriter, r *http.Request) {
	recipient, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to decline shared transactions.")
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
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	owner, transactionID, ok := decodeShareInput(body)
	if !ok {
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	item, err := h.db.DeclineInboxShare(recipient, owner, transactionID)
	if err != nil {
		writeStoreError(w, err, "Shared transaction not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

// serveDismiss hides an item without changing its decision, or unhides it
// when dismissed=false. Retries return the recorded item.
func (h *Handler) serveDismiss(w http.ResponseWriter, r *http.Request) {
	recipient, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to manage your inbox.")
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
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	var input struct {
		shareInput
		Dismissed *bool `json:"dismissed"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	owner, err := resourceOwner(strings.TrimSpace(input.Owner))
	if err != nil || strings.TrimSpace(input.TransactionID) == "" {
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	dismissed := true
	if input.Dismissed != nil {
		dismissed = *input.Dismissed
	}
	item, err := h.db.SetInboxShareDismissed(recipient, owner, strings.TrimSpace(input.TransactionID), dismissed)
	if err != nil {
		writeStoreError(w, err, "Shared transaction not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

// serveRead marks an item read, or unread when read=false. Listing,
// viewing, and deciding never change unread state; only this action does.
func (h *Handler) serveRead(w http.ResponseWriter, r *http.Request) {
	recipient, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to manage your inbox.")
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
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	var input struct {
		shareInput
		Read *bool `json:"read"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	owner, err := resourceOwner(strings.TrimSpace(input.Owner))
	if err != nil || strings.TrimSpace(input.TransactionID) == "" {
		writeProblem(w, http.StatusBadRequest, "The inbox request is invalid.")
		return
	}
	read := true
	if input.Read != nil {
		read = *input.Read
	}
	item, err := h.db.SetInboxShareRead(recipient, owner, strings.TrimSpace(input.TransactionID), read)
	if err != nil {
		writeStoreError(w, err, "Shared transaction not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}
