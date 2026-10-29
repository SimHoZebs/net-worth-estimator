// Package groups serves social user groups over HTTP.
// Groups never touch financial plans. Membership is enforced here from
// application tables. Only authenticated subjects may call these routes.
//
// Status contract: unknown groups or members report 404 (store.ErrNotFound),
// including reads by non-members so membership is not enumerable. Denied
// actions by members report 403 (store.ErrGroupForbidden); privileged
// reads such as invite listing deny under-privileged members with 403.
// Rejected input reports 400 (store.ErrGroupInvalid, message safe to show),
// and anything else reports 503 without leaking internals.
package groups

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Config carries transport policy shared with the plan API. Groups obey the
// global read-only kill switch: no exemption.
type Config struct {
	AllowedOrigins []string
	ReadOnly       bool
}

// Handler routes group requests. The identity middleware supplies Principal.
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
	mux.HandleFunc("/v1/groups", h.serveGroups)
	mux.HandleFunc("/v1/groups/", h.serveGroupResource)
	mux.HandleFunc("/v1/invites/accept", h.serveAccept)
	return middleware.Recoverer(api.CORSMiddleware(h.origins)(mux))
}

func userID(r *http.Request) (string, string, bool) {
	subject := identity.Subject(r.Context())
	if subject == "" {
		return "", "", false
	}
	// Issuer is server config. Display name comes from the session principal.
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

// writeStoreError maps store results to the status contract. notFound names
// the missing resource for 404s. Validation messages are safe to show;
// anything else becomes a generic 503 without internals.
func writeStoreError(w http.ResponseWriter, err error, notFound string) {
	switch {
	case err == nil:
		return
	case errors.Is(err, store.ErrGroupForbidden):
		writeProblem(w, http.StatusForbidden, "This action is not permitted in this group.")
	case errors.Is(err, store.ErrNotFound), store.IsNotFound(err):
		writeProblem(w, http.StatusNotFound, notFound)
	case errors.Is(err, store.ErrGroupInvalid):
		writeProblem(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "invalid group request: "))
	default:
		writeProblem(w, http.StatusServiceUnavailable, "Group storage is temporarily unavailable.")
	}
}

func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return io.ReadAll(r.Body)
}

func (h *Handler) ensureUser(subject string) (string, error) {
	return h.db.EnsureGroupUser(h.issuer, subject)
}

// locked rejects state-changing requests while the server is read-only,
// mirroring the plan API kill switch.
func (h *Handler) locked(w http.ResponseWriter, r *http.Request) bool {
	if h.readOnly {
		writeProblem(w, http.StatusForbidden, "The server is read-only. Groups cannot be changed right now.")
		return true
	}
	return false
}

func (h *Handler) serveGroups(w http.ResponseWriter, r *http.Request) {
	subject, name, ok := userID(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to manage groups.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		user, err := h.ensureUser(subject)
		if err != nil {
			writeProblem(w, http.StatusServiceUnavailable, "Group storage is temporarily unavailable.")
			return
		}
		h.db.TouchMemberDisplay(user, name)
		groups, err := h.db.ListGroupsForUser(user)
		if err != nil {
			writeProblem(w, http.StatusServiceUnavailable, "Groups could not be loaded.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
	case http.MethodPost:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The group request is invalid.")
			return
		}
		var input struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(body, &input); err != nil {
			writeProblem(w, http.StatusBadRequest, "The group request is invalid.")
			return
		}
		user, err := h.ensureUser(subject)
		if err != nil {
			writeProblem(w, http.StatusServiceUnavailable, "Group storage is temporarily unavailable.")
			return
		}
		group, err := h.db.CreateGroup(user, input.Name, name)
		if err != nil {
			writeStoreError(w, err, "Group not found.")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"group": group})
	default:
		w.Header().Set("Allow", "GET, POST")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

func (h *Handler) serveGroupResource(w http.ResponseWriter, r *http.Request) {
	subject, name, ok := userID(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to manage groups.")
		return
	}
	user, err := h.ensureUser(subject)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Group storage is temporarily unavailable.")
		return
	}
	h.db.TouchMemberDisplay(user, name)
	rest := strings.TrimPrefix(r.URL.Path, "/v1/groups/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeProblem(w, http.StatusNotFound, "Group not found.")
		return
	}
	groupID, tail := parts[0], parts[1:]
	if len(tail) == 0 {
		switch r.Method {
		case http.MethodGet:
			group, err := h.db.GetGroup(groupID, user)
			if err != nil {
				writeStoreError(w, err, "Group not found.")
				return
			}
			members, err := h.db.ListGroupMembers(groupID, user)
			if err != nil {
				writeStoreError(w, err, "Group not found.")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"group": group, "members": members})
		case http.MethodPatch:
			if h.locked(w, r) {
				return
			}
			body, err := readBody(w, r, 1<<16)
			if err != nil {
				writeProblem(w, http.StatusBadRequest, "The group request is invalid.")
				return
			}
			var input struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(body, &input); err != nil {
				writeProblem(w, http.StatusBadRequest, "The group request is invalid.")
				return
			}
			if err := h.db.RenameGroup(groupID, user, input.Name); err != nil {
				if errors.Is(err, store.ErrGroupForbidden) {
					writeProblem(w, http.StatusForbidden, "Only owners and admins may rename this group.")
					return
				}
				writeStoreError(w, err, "Group not found.")
				return
			}
			group, err := h.db.GetGroup(groupID, user)
			if err != nil {
				writeStoreError(w, err, "Group not found.")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"group": group})
		case http.MethodDelete:
			if h.locked(w, r) {
				return
			}
			if err := h.db.DeleteGroup(groupID, user); err != nil {
				if errors.Is(err, store.ErrGroupForbidden) {
					writeProblem(w, http.StatusForbidden, "Only owners may delete this group.")
					return
				}
				writeStoreError(w, err, "Group not found.")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"deleted": groupID})
		default:
			w.Header().Set("Allow", "GET, PATCH, DELETE")
			writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		}
		return
	}
	switch tail[0] {
	case "members":
		h.serveMembers(w, r, groupID, user, tail[1:])
	case "invites":
		h.serveInvites(w, r, groupID, user, tail[1:])
	case "leave":
		if len(tail) != 1 {
			writeProblem(w, http.StatusNotFound, "Group not found.")
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
		if err := h.db.LeaveGroup(groupID, user); err != nil {
			writeStoreError(w, err, "Group not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"left": groupID})
	default:
		writeProblem(w, http.StatusNotFound, "Group not found.")
	}
}

func (h *Handler) serveMembers(w http.ResponseWriter, r *http.Request, groupID, user string, tail []string) {
	if len(tail) == 0 {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
			return
		}
		members, err := h.db.ListGroupMembers(groupID, user)
		if err != nil {
			writeStoreError(w, err, "Group not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"members": members})
		return
	}
	target := tail[0]
	if len(tail) != 1 {
		writeProblem(w, http.StatusNotFound, "Group not found.")
		return
	}
	// Target is a user ID like user:<hex>. Resolve is unnecessary:
	// callers copy it from the member list.
	switch r.Method {
	case http.MethodPatch:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The member request is invalid.")
			return
		}
		var input struct {
			Role string `json:"role"`
		}
		if err := json.Unmarshal(body, &input); err != nil {
			writeProblem(w, http.StatusBadRequest, "The member request is invalid.")
			return
		}
		if err := h.db.UpdateMemberRole(groupID, user, target, input.Role); err != nil {
			if errors.Is(err, store.ErrGroupForbidden) {
				writeProblem(w, http.StatusForbidden, "Only owners may change roles.")
				return
			}
			writeStoreError(w, err, "Member not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"updated": target})
	case http.MethodDelete:
		if h.locked(w, r) {
			return
		}
		if err := h.db.RemoveMember(groupID, user, target); err != nil {
			if errors.Is(err, store.ErrGroupForbidden) {
				writeProblem(w, http.StatusForbidden, "You may not remove this member.")
				return
			}
			writeStoreError(w, err, "Member not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"removed": target})
	default:
		w.Header().Set("Allow", "PATCH, DELETE")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

func (h *Handler) serveInvites(w http.ResponseWriter, r *http.Request, groupID, user string, tail []string) {
	if len(tail) == 0 {
		switch r.Method {
		case http.MethodGet:
			invites, err := h.db.ListInvites(groupID, user)
			if err != nil {
				if errors.Is(err, store.ErrGroupForbidden) {
					writeProblem(w, http.StatusForbidden, "Only owners and admins may view invites.")
					return
				}
				writeStoreError(w, err, "Group not found.")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
		case http.MethodPost:
			if h.locked(w, r) {
				return
			}
			body, err := readBody(w, r, 1<<16)
			if err != nil {
				writeProblem(w, http.StatusBadRequest, "The invite request is invalid.")
				return
			}
			var input struct {
				MaxUses int `json:"maxUses"`
				TTLDays int `json:"ttlDays"`
			}
			if err := json.Unmarshal(body, &input); err != nil {
				writeProblem(w, http.StatusBadRequest, "The invite request is invalid.")
				return
			}
			if input.MaxUses == 0 {
				input.MaxUses = 1
			}
			if input.TTLDays == 0 {
				input.TTLDays = 7
			}
			invite, code, err := h.db.CreateInvite(groupID, user, input.MaxUses, time.Duration(input.TTLDays)*24*time.Hour)
			if err != nil {
				if errors.Is(err, store.ErrGroupForbidden) {
					writeProblem(w, http.StatusForbidden, "Only owners and admins may invite.")
					return
				}
				writeStoreError(w, err, "Group not found.")
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"invite": invite, "code": code})
		default:
			w.Header().Set("Allow", "GET, POST")
			writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		}
		return
	}
	if len(tail) != 1 {
		writeProblem(w, http.StatusNotFound, "Invite not found.")
		return
	}
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", "DELETE")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	if h.locked(w, r) {
		return
	}
	if err := h.db.RevokeInvite(groupID, tail[0], user); err != nil {
		if errors.Is(err, store.ErrGroupForbidden) {
			writeProblem(w, http.StatusForbidden, "Only owners and admins may revoke invites.")
			return
		}
		writeStoreError(w, err, "Invite not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": tail[0]})
}

func (h *Handler) serveAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
		return
	}
	if h.locked(w, r) {
		return
	}
	subject, name, ok := userID(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to join a group.")
		return
	}
	body, err := readBody(w, r, 1<<16)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "The invite request is invalid.")
		return
	}
	var input struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeProblem(w, http.StatusBadRequest, "The invite request is invalid.")
		return
	}
	user, err := h.ensureUser(subject)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Group storage is temporarily unavailable.")
		return
	}
	group, err := h.db.AcceptInvite(input.Code, user, name)
	if err != nil {
		writeStoreError(w, err, "Invite not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": group})
}
