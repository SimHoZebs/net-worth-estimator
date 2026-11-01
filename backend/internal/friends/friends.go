// Package friends serves accepted-friend reads over HTTP. Friendships are
// social only: they never touch financial plans, and friendship alone
// grants no financial data access. Only authenticated subjects may call
// these routes.
//
// Status contract: unknown users and non-friends report 404
// (store.ErrNotFound) so friendships are not enumerable. A caller's own
// accepted list is visible only to that caller. There are no write routes
// yet: the request lifecycle (send, accept, decline, remove, block) is
// undecided product scope and must not be guessed here.
package friends

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Config carries transport policy shared with the plan API.
type Config struct {
	AllowedOrigins []string
	ReadOnly       bool
}

// Handler routes friend requests. The identity middleware supplies Principal.
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
	mux.HandleFunc("/v1/friends", h.serveFriends)
	mux.HandleFunc("/v1/friends/", h.serveFriend)
	return middleware.Recoverer(api.CORSMiddleware(h.origins)(mux))
}

func userID(r *http.Request) (string, string, bool) {
	subject := identity.Subject(r.Context())
	if subject == "" {
		return "", "", false
	}
	name := identity.Name(r.Context())
	return subject, name, true
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

// writeStoreError maps store results to the status contract. Non-friends
// read 404; anything else reports 503 without leaking internals.
func writeStoreError(w http.ResponseWriter, err error, notFound string) {
	switch {
	case err == nil:
		return
	case errors.Is(err, store.ErrNotFound), store.IsNotFound(err):
		writeProblem(w, http.StatusNotFound, notFound)
	default:
		writeProblem(w, http.StatusServiceUnavailable, "Friends could not be loaded.")
	}
}

func (h *Handler) ensureUser(subject string) (string, error) {
	return h.db.EnsureGroupUser(h.issuer, subject)
}

func (h *Handler) serveFriends(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	subject, name, ok := userID(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to see friends.")
		return
	}
	user, err := h.ensureUser(subject)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Friends could not be loaded.")
		return
	}
	h.db.TouchFriendDisplay(user, name)
	friends, err := h.db.ListFriends(user, r.URL.Query().Get("search"))
	if err != nil {
		writeStoreError(w, err, "Friends could not be loaded.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"friends": friends})
}

func (h *Handler) serveFriend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	subject, name, ok := userID(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to see friends.")
		return
	}
	user, err := h.ensureUser(subject)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Friends could not be loaded.")
		return
	}
	h.db.TouchFriendDisplay(user, name)
	// Friend IDs are opaque stable user IDs (user:<hex>, no slashes), so
	// the remainder is one path segment. Anything else is not a friend.
	target := strings.TrimPrefix(r.URL.Path, "/v1/friends/")
	if target == "" || strings.Contains(target, "/") {
		writeProblem(w, http.StatusNotFound, "Friend not found.")
		return
	}
	friend, err := h.db.GetFriend(user, target)
	if err != nil {
		writeStoreError(w, err, "Friend not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"friend": friend})
}
