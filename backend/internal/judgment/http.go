package judgment

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// HTTPProvider implements the neutral state/feedback/evaluate protocol. It has
// no knowledge of model algorithms, feature engineering, or learning policy.
type HTTPProvider struct {
	baseURL string
	client  *http.Client
}

func NewHTTPProvider(baseURL string, timeout time.Duration) *HTTPProvider {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &HTTPProvider{strings.TrimRight(baseURL, "/"), &http.Client{Timeout: timeout}}
}

func (p *HTTPProvider) post(ctx context.Context, path string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("judgment provider %s: %d", path, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(output)
}

type remoteState struct {
	Revision string `json:"revision"`
	Cursor   string `json:"cursor"`
}
type feedbackBatch struct {
	Owner string `json:"owner"`
	After string `json:"after"`
	FeedbackPage
}

func (p *HTTPProvider) state(ctx context.Context, owner string) (remoteState, error) {
	var state remoteState
	err := p.post(ctx, "/state", map[string]string{"owner": owner}, &state)
	if err == nil && state.Revision == "" {
		err = fmt.Errorf("judgment provider returned an empty revision")
	}
	return state, err
}

func (p *HTTPProvider) Open(ctx context.Context, source FeedbackSource) (Session, error) {
	state, err := p.state(ctx, source.Owner())
	if err != nil {
		return nil, err
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := source.Page(state.Cursor, 200)
		if err != nil {
			return nil, err
		}
		if page.Cursor == state.Cursor {
			break
		}
		if page.Cursor < state.Cursor {
			return nil, fmt.Errorf("feedback cursor moved backwards")
		}
		var ack remoteState
		if err := p.post(ctx, "/feedback", feedbackBatch{source.Owner(), state.Cursor, page}, &ack); err != nil {
			return nil, err
		}
		if ack.Cursor != page.Cursor {
			return nil, fmt.Errorf("judgment provider did not acknowledge feedback")
		}
		state.Cursor = page.Cursor
	}
	state, err = p.state(ctx, source.Owner())
	if err != nil {
		return nil, err
	}
	// Changing endpoint is also a provider change, even if revision strings match.
	namespace := sha256.Sum256([]byte(p.baseURL))
	return httpSession{p, hex.EncodeToString(namespace[:8]) + ":" + state.Revision}, nil
}

type httpSession struct {
	provider *HTTPProvider
	revision string
}

func (s httpSession) Revision() string { return s.revision }
func (s httpSession) Evaluate(ctx context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	var out struct {
		Judgments []types.AnalysisJudgment `json:"judgments"`
	}
	err := s.provider.post(ctx, "/evaluate", struct {
		Requests []types.AnalysisJudgmentInput `json:"requests"`
	}{requests}, &out)
	return out.Judgments, err
}
