package gmail

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const gmailAPIBase = "https://gmail.googleapis.com/gmail/v1/users/me"

// httpFetcher is the production MessageFetcher over the Gmail REST API.
// It sends only the short-lived access token and list/get parameters;
// tokens and message content never enter logs or storage.
type httpFetcher struct {
	client *http.Client
}

func newHTTPFetcher(client *http.Client) *httpFetcher {
	if client == nil {
		client = http.DefaultClient
	}
	return &httpFetcher{client: client}
}

func (f *httpFetcher) authorize(request *http.Request, token string) {
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
}

func (f *httpFetcher) get(ctx context.Context, token, path string, query url.Values) (*http.Response, error) {
	target := gmailAPIBase + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	f.authorize(request, token)
	response, err := f.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("gmail request: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("gmail request: unexpected status %d", response.StatusCode)
	}
	return response, nil
}

// ListRecent lists recent message IDs after the given time for the
// initial scan, newest first in pages of up to 100.
func (f *httpFetcher) ListRecent(ctx context.Context, token string, after time.Time, pageToken string) (MessagePage, error) {
	query := url.Values{
		"q":          {fmt.Sprintf("newer_than:%dd", daysSince(after, time.Now()))},
		"maxResults": {"100"},
	}
	if pageToken != "" {
		query.Set("pageToken", pageToken)
	}
	response, err := f.get(ctx, token, "/messages", query)
	if err != nil {
		return MessagePage{}, err
	}
	defer response.Body.Close()
	var listed struct {
		Messages []struct {
			ID       string `json:"id"`
			ThreadID string `json:"threadId"`
		} `json:"messages"`
		NextPageToken string `json:"nextPageToken"`
	}
	if err := json.NewDecoder(response.Body).Decode(&listed); err != nil {
		return MessagePage{}, fmt.Errorf("gmail list: %w", err)
	}
	page := MessagePage{NextPageToken: listed.NextPageToken}
	for _, item := range listed.Messages {
		if item.ID != "" {
			page.IDs = append(page.IDs, item.ID)
		}
	}
	return page, nil
}

// ListSince lists message IDs changed since the history cursor for
// incremental scans, following history pages to the newest history ID.
func (f *httpFetcher) ListSince(ctx context.Context, token string, historyID string, pageToken string) (MessagePage, error) {
	query := url.Values{
		"startHistoryId": {historyID},
		"historyTypes":   {"messageAdded"},
	}
	if pageToken != "" {
		query.Set("pageToken", pageToken)
	}
	response, err := f.get(ctx, token, "/history", query)
	if err != nil {
		return MessagePage{}, err
	}
	defer response.Body.Close()
	var listed struct {
		History []struct {
			Messages []struct {
				ID       string `json:"id"`
				ThreadID string `json:"threadId"`
			} `json:"messagesAdded"`
		} `json:"history"`
		NextPageToken string `json:"nextPageToken"`
		HistoryID     string `json:"historyId"`
	}
	if err := json.NewDecoder(response.Body).Decode(&listed); err != nil {
		return MessagePage{}, fmt.Errorf("gmail history: %w", err)
	}
	page := MessagePage{NextPageToken: listed.NextPageToken, LatestHistoryID: listed.HistoryID}
	seen := map[string]bool{}
	for _, entry := range listed.History {
		for _, item := range entry.Messages {
			if item.ID != "" && !seen[item.ID] {
				seen[item.ID] = true
				page.IDs = append(page.IDs, item.ID)
			}
		}
	}
	return page, nil
}

func daysSince(after, now time.Time) int {
	days := int(now.Sub(after).Hours()/24) + 1
	if days < 1 {
		return 1
	}
	return days
}

type gmailPayload struct {
	MimeType string `json:"mimeType"`
	Headers  []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"headers"`
	Body struct {
		Data string `json:"data"`
	} `json:"body"`
	Parts []gmailPayload `json:"parts"`
}

// GetMessage fetches one message with headers and plain-text content.
// Attachments and non-text parts are ignored; only headers plus the
// first text/plain (else text/html stripped of markup) content return.
func (f *httpFetcher) GetMessage(ctx context.Context, token string, id string) (Message, error) {
	if strings.TrimSpace(id) == "" {
		return Message{}, fmt.Errorf("gmail message: missing id")
	}
	response, err := f.get(ctx, token, "/messages/"+url.PathEscape(id), url.Values{"format": {"full"}})
	if err != nil {
		return Message{}, err
	}
	defer response.Body.Close()
	var raw struct {
		ID        string       `json:"id"`
		ThreadID  string       `json:"threadId"`
		HistoryID string       `json:"historyId"`
		Payload   gmailPayload `json:"payload"`
		Snippet   string       `json:"snippet"`
	}
	if err := json.NewDecoder(response.Body).Decode(&raw); err != nil {
		return Message{}, fmt.Errorf("gmail message: %w", err)
	}
	message := Message{ID: raw.ID, ThreadID: raw.ThreadID, HistoryID: raw.HistoryID}
	for _, header := range raw.Payload.Headers {
		switch strings.ToLower(header.Name) {
		case "from":
			message.From = header.Value
		case "subject":
			message.Subject = header.Value
		case "date":
			if stamp, err := parseMessageDate(header.Value); err == nil {
				message.Date = stamp
			}
		}
	}
	if text := payloadText(raw.Payload); text != "" {
		message.Body = text
	} else {
		message.Body = raw.Snippet
	}
	return message, nil
}

func parseMessageDate(value string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, fmt.Errorf("empty date")
	}
	layouts := []string{
		time.RFC1123Z,
		time.RFC1123,
		"Mon, 2 Jan 2006 15:04:05 -0700",
		"Mon, 2 Jan 2006 15:04:05 MST",
		time.RFC3339,
	}
	var err error
	var stamp time.Time
	for _, layout := range layouts {
		if stamp, err = time.Parse(layout, trimmed); err == nil {
			return stamp, nil
		}
	}
	return time.Time{}, err
}

// payloadText returns the first text/plain part, else the first text/html
// part stripped of markup. Base64url bodies decode; undecodable parts
// are skipped so one bad part never fails the message.
func payloadText(payload gmailPayload) string {
	if strings.HasPrefix(payload.MimeType, "text/plain") {
		if text, ok := decodeBody(payload.Body.Data); ok {
			return text
		}
	}
	html := ""
	var walk func(part gmailPayload)
	walk = func(part gmailPayload) {
		for _, child := range part.Parts {
			walk(child)
		}
		if html != "" || !strings.HasPrefix(part.MimeType, "text/html") {
			return
		}
		if text, ok := decodeBody(part.Body.Data); ok {
			html = text
		}
	}
	walk(payload)
	return stripMarkup(html)
}

func decodeBody(data string) (string, bool) {
	trimmed := strings.TrimSpace(data)
	if trimmed == "" {
		return "", false
	}
	raw, err := base64.URLEncoding.DecodeString(trimmed)
	if err != nil {
		raw, err = base64.RawURLEncoding.DecodeString(trimmed)
		if err != nil {
			return "", false
		}
	}
	return string(raw), true
}

var tagPattern = regexp.MustCompile(`<[^>]*>`)

// stripMarkup removes HTML tags and collapses whitespace so text/html
// bodies still expose amounts and references to the extractor.
func stripMarkup(html string) string {
	if html == "" {
		return ""
	}
	text := tagPattern.ReplaceAllString(html, " ")
	fields := strings.Fields(text)
	return strings.Join(fields, " ")
}
