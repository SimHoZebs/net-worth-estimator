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
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
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
	mux.HandleFunc("/v1/shared/policies/", h.servePolicies)
	mux.HandleFunc("/v1/shared/groups/", h.serveGroupFeed)
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

// servePolicies serves one member's automatic-sharing preference for one
// group (GRP-02) plus the counts-only consent preview (GRP-04). The owner
// is always the authenticated caller: there is no owner field to forge,
// so a group administrator cannot read or force another member's consent.
// An absent preference reports 404, which means automatic sharing is off.
func (h *Handler) servePolicies(w http.ResponseWriter, r *http.Request) {
	owner, _, ok := h.caller(r)
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "Sign in to share transactions.")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/shared/policies/")
	groupID, tail, _ := strings.Cut(rest, "/")
	if groupID == "" || strings.Contains(tail, "/") {
		writeProblem(w, http.StatusNotFound, "Sharing preference not found.")
		return
	}
	if tail == "preview" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
			return
		}
		// Preview persists nothing, so the read-only guard does not apply:
		// the consent screen can count exposure while writes are locked.
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		input, err := decodePolicyInput(body)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		preview, err := h.db.PreviewSharingPolicyDraft(owner, groupID, input)
		if err != nil {
			writeStoreError(w, err, "Sharing preference not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"preview": preview})
		return
	}
	if tail != "" {
		writeProblem(w, http.StatusNotFound, "Sharing preference not found.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		policy, err := h.db.GetSharingPolicy(owner, groupID)
		if err != nil {
			writeStoreError(w, err, "Sharing preference not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"policy": policy})
	case http.MethodPut:
		if h.locked(w, r) {
			return
		}
		body, err := readBody(w, r, 1<<16)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		input, err := decodePolicyInput(body)
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "The sharing request is invalid.")
			return
		}
		policy, err := h.db.SetSharingPolicy(owner, groupID, input)
		if err != nil {
			writeStoreError(w, err, "Sharing preference not found.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"policy": policy})
	default:
		w.Header().Set("Allow", "GET, PUT")
		writeProblem(w, http.StatusMethodNotAllowed, "Method not allowed.")
	}
}

type policyInput struct {
	Enabled    bool     `json:"enabled"`
	AccountIDs []string `json:"accountIds"`
	StartDate  string   `json:"startDate"`
	EndDate    string   `json:"endDate"`
}

func decodePolicyInput(body []byte) (store.SharingPolicyInput, error) {
	var input policyInput
	if err := json.Unmarshal(body, &input); err != nil {
		return store.SharingPolicyInput{}, err
	}
	return store.SharingPolicyInput{
		Enabled:    input.Enabled,
		AccountIDs: input.AccountIDs,
		StartDate:  strings.TrimSpace(input.StartDate),
		EndDate:    strings.TrimSpace(input.EndDate),
	}, nil
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

// serveGroupFeed serves one group's shared transaction feed (GRP-03): the
// requester's authorized postings in that group, each listed once with its
// source member and audiences, plus viewer-specific totals over the
// filtered set. Date, member, and direction filters narrow the authorized
// set for navigation only and never widen eligibility. Pagination is a
// keyset over the owner-then-posting order: cursor names the last item of
// the previous page. Filters, totals, and pages all derive from the same
// gated read, so counts and sums always describe exactly the listed set.
func (h *Handler) serveGroupFeed(w http.ResponseWriter, r *http.Request) {
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
	rest := strings.TrimPrefix(r.URL.Path, "/v1/shared/groups/")
	parts := strings.SplitN(rest, "/", 3)
	if len(parts) != 2 || parts[0] == "" || parts[1] != "feed" {
		writeProblem(w, http.StatusNotFound, "Shared transactions not found.")
		return
	}
	if _, err := uuid.Parse(parts[0]); err != nil {
		writeProblem(w, http.StatusNotFound, "Shared transactions not found.")
		return
	}
	groupID := parts[0]
	items, err := h.db.ListGroupSharedFeed(requester, groupID)
	if err != nil {
		writeStoreError(w, err, "Shared transactions not found.")
		return
	}
	filters, err := parseFeedFilters(r.URL.Query())
	if err != nil {
		writeProblem(w, http.StatusBadRequest, err.Error())
		return
	}
	filtered := applyFeedFilters(items, filters)
	totals := sumFeedTotals(filtered)
	page, next, hasMore := pageFeedItems(filtered, filters.cursor, filters.limit)
	writeJSON(w, http.StatusOK, map[string]any{
		"groupId": groupID,
		"items":   page,
		"totals":  totals,
		"page":    map[string]any{"nextCursor": next, "hasMore": hasMore},
	})
}

// feedDirection classifies a posting by money movement: external inflow,
// external outflow, or an account-to-account transfer. Rows with neither
// side classify nowhere and appear only when no direction filter applies.
func feedDirection(posting types.Posting) string {
	switch {
	case posting.SourceAccountID == nil && len(posting.Destinations) > 0:
		return "in"
	case posting.SourceAccountID != nil && len(posting.Destinations) == 0:
		return "out"
	case posting.SourceAccountID != nil && len(posting.Destinations) > 0:
		return "transfer"
	default:
		return ""
	}
}

type feedFilters struct {
	start     string
	end       string
	members   map[string]bool
	direction map[string]bool
	cursor    feedCursor
	limit     int
}

type feedCursor struct {
	set     bool
	owner   string
	posting string
}

// parseFeedFilters reads the navigation filters. Every rejection is a 400
// with a plain-language reason: dates are YYYY-MM-DD days, members are
// user resources, directions are money in, money out, or transfer, and the
// page takes at most 100 items.
func parseFeedFilters(query url.Values) (feedFilters, error) {
	filters := feedFilters{
		start:     strings.TrimSpace(query.Get("startDate")),
		end:       strings.TrimSpace(query.Get("endDate")),
		members:   map[string]bool{},
		direction: map[string]bool{},
		limit:     20,
	}
	for _, day := range []string{filters.start, filters.end} {
		if day == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", day); err != nil {
			return feedFilters{}, errors.New("Filter dates use YYYY-MM-DD.")
		}
	}
	if filters.start != "" && filters.end != "" && filters.start > filters.end {
		return feedFilters{}, errors.New("The start date is after the end date.")
	}
	for _, member := range query["member"] {
		owner, err := resourceOwner(strings.TrimSpace(member))
		if err != nil {
			return feedFilters{}, errors.New("Member filters name a user.")
		}
		filters.members[owner] = true
	}
	for _, direction := range query["direction"] {
		switch strings.TrimSpace(direction) {
		case "in", "out", "transfer":
			filters.direction[strings.TrimSpace(direction)] = true
		default:
			return feedFilters{}, errors.New("Direction filters are money in, money out, or transfer.")
		}
	}
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			return feedFilters{}, errors.New("A page takes 1 to 100 transactions.")
		}
		filters.limit = limit
	}
	if raw := strings.TrimSpace(query.Get("cursor")); raw != "" {
		cursor, err := decodeFeedCursor(raw)
		if err != nil {
			return feedFilters{}, errors.New("The page cursor is invalid. Start from the first page.")
		}
		filters.cursor = cursor
	}
	return filters, nil
}

// applyFeedFilters narrows the gated feed for navigation. Items arrive
// authorized; filtering only hides, so eligibility never widens here.
func applyFeedFilters(items []store.GroupFeedItem, filters feedFilters) []store.GroupFeedItem {
	if filters.start == "" && filters.end == "" && len(filters.members) == 0 && len(filters.direction) == 0 {
		return items
	}
	filtered := []store.GroupFeedItem{}
	for _, item := range items {
		if len(filters.members) > 0 && !filters.members[item.OwnerUserID] {
			continue
		}
		if len(filters.direction) > 0 && !filters.direction[feedDirection(item.Posting)] {
			continue
		}
		if filters.start != "" || filters.end != "" {
			day := time.Unix(item.Posting.TransactionTime, 0).UTC().Format("2006-01-02")
			if filters.start != "" && day < filters.start {
				continue
			}
			if filters.end != "" && day > filters.end {
				continue
			}
		}
		filtered = append(filtered, item)
	}
	return filtered
}

// sumFeedTotals computes viewer-specific totals over the filtered feed:
// one count per authorized posting, the rounded sum of fixed amounts, and
// the pending and calculated-amount rows inside the count but outside the
// sum. Totals and pages derive from the same filtered set, so they always
// agree.
func sumFeedTotals(items []store.GroupFeedItem) store.GroupFeedTotals {
	totals := store.GroupFeedTotals{Count: len(items)}
	for _, item := range items {
		if item.Posting.Pending {
			totals.PendingCount++
		}
		amount, fixed := store.FeedLiteralAmount(item.Posting.Amount)
		if !fixed {
			totals.VaryingCount++
			continue
		}
		totals.TotalAmount += amount
	}
	totals.TotalAmount = math.Round(totals.TotalAmount*100) / 100
	return totals
}

// pageFeedItems slices one keyset page over the owner-then-posting order.
// The cursor names the last item of the previous page; items at or before
// it stay behind. The next cursor names the page's last item when more
// items remain.
func pageFeedItems(items []store.GroupFeedItem, cursor feedCursor, limit int) ([]store.GroupFeedItem, string, bool) {
	start := 0
	if cursor.set {
		for i, item := range items {
			if item.OwnerUserID == cursor.owner && item.Posting.ID == cursor.posting {
				start = i + 1
				break
			}
			if item.OwnerUserID > cursor.owner ||
				(item.OwnerUserID == cursor.owner && item.Posting.ID > cursor.posting) {
				start = i
				break
			}
			start = i + 1
		}
	}
	if start > len(items) {
		start = len(items)
	}
	end := start + limit
	hasMore := end < len(items)
	if end > len(items) {
		end = len(items)
	}
	page := items[start:end]
	if len(page) == 0 {
		return []store.GroupFeedItem{}, "", false
	}
	next := ""
	if hasMore {
		next = encodeFeedCursor(page[len(page)-1].OwnerUserID, page[len(page)-1].Posting.ID)
	}
	return page, next, hasMore
}

func encodeFeedCursor(owner, posting string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(owner + "\x00" + posting))
}

func decodeFeedCursor(raw string) (feedCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return feedCursor{}, err
	}
	owner, posting, found := strings.Cut(string(decoded), "\x00")
	if !found || owner == "" || posting == "" {
		return feedCursor{}, errors.New("invalid feed cursor")
	}
	return feedCursor{set: true, owner: owner, posting: posting}, nil
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
