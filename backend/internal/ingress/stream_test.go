package ingress

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRewritingProxyPreservesIncrementalStreaming(t *testing.T) {
	wrap, err := New(testSecret, []string{"https://app.test"})
	if err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(release) }) }
	backend := httptest.NewServer(wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "event: progress\ndata: {}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-release:
			_, _ = fmt.Fprint(w, "event: result\ndata: {}\n\n")
		case <-r.Context().Done():
		}
	})))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	edge := httptest.NewServer(&httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Header.Set(SecretHeader, testSecret)
			pr.Out.Header.Set(OriginHeader, "https://app.test")
		},
		FlushInterval: -1,
	})
	defer edge.Close()
	defer finish()
	client := edge.Client()
	client.Timeout = 3 * time.Second
	response, err := client.Post(edge.URL+"/v1/projections/stochastic", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	first, err := reader.ReadString('\n')
	if err != nil || first != "event: progress\n" {
		t.Fatalf("progress was not delivered before computation completed: %q %v", first, err)
	}
	finish()
	rest, err := io.ReadAll(reader)
	if err != nil || !strings.Contains(string(rest), "event: result\n") {
		t.Fatalf("stream did not complete: %s %v", rest, err)
	}
}
