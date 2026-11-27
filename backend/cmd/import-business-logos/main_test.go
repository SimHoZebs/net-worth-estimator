package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
)

type importRoundTripFunc func(*http.Request) (*http.Response, error)

func (function importRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type fakeLogoImporter struct {
	calls    []string
	download func(string) ([]byte, error)
}

func (importer *fakeLogoImporter) Download(_ context.Context, key string) ([]byte, error) {
	importer.calls = append(importer.calls, key)
	return importer.download(key)
}

func runImport(t *testing.T, args []string, secret string, importer logoImporter) (code int, stdout, stderr string, factoryCalls int) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runWithDependencies(args, &out, &errOut, importDependencies{
		newImporter: func(got string) (logoImporter, error) {
			factoryCalls++
			if got != secret {
				t.Errorf("factory secret = %q, want %q", got, secret)
			}
			return importer, nil
		},
		getenv: func(name string) string {
			if name != logoDevSecretEnv {
				t.Errorf("unexpected environment lookup %q", name)
			}
			return secret
		},
	})
	return code, out.String(), errOut.String(), factoryCalls
}

func TestSelectionAndDirectoryErrorsDoNotStartAnImport(t *testing.T) {
	directory := t.TempDir()
	missing := filepath.Join(t.TempDir(), "missing")
	importer := &fakeLogoImporter{download: func(string) ([]byte, error) { return []byte("logo"), nil }}
	for _, args := range [][]string{
		nil,
		{"--dir", directory},
		{"--dir", "", "amazon"},
		{"--dir", directory, "--all", "amazon"},
		{"--dir", directory, "unknown"},
		{"--dir", directory, "../amazon"},
		{"--dir", missing, "amazon"},
		{"--dir", directory, "--secret", "sk_not-a-flag", "amazon"},
	} {
		code, stdout, stderr, factoryCalls := runImport(t, args, "sk_test", importer)
		if code != 2 || stdout != "" || stderr == "" || factoryCalls != 0 || len(importer.calls) != 0 {
			t.Fatalf("args=%v code=%d stdout=%q stderr=%q factory=%d calls=%v", args, code, stdout, stderr, factoryCalls, importer.calls)
		}
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatalf("missing --dir was created: %v", err)
	}
}

func TestExistingFilesSkipWithoutKeyAndRefreshAtomically(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "amazon.png")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	importer := &fakeLogoImporter{download: func(string) ([]byte, error) { return []byte("new"), nil }}
	code, stdout, stderr, factoryCalls := runImport(t, []string{"--dir", directory, "amazon"}, "", importer)
	if code != 0 || stderr != "" || !strings.Contains(stdout, "amazon: skipped") || factoryCalls != 0 || len(importer.calls) != 0 {
		t.Fatalf("skip code=%d stdout=%q stderr=%q factory=%d calls=%v", code, stdout, stderr, factoryCalls, importer.calls)
	}
	code, _, stderr, _ = runImport(t, []string{"--dir", directory, "--refresh", "amazon"}, "sk_test", importer)
	if code != 0 || stderr != "" || !slices.Equal(importer.calls, []string{"amazon"}) {
		t.Fatalf("refresh code=%d stderr=%q calls=%v", code, stderr, importer.calls)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "new" {
		t.Fatalf("refreshed target = %q %v", data, err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("target mode = %v", info.Mode().Perm())
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 1 || entries[0].Name() != "amazon.png" {
		t.Fatalf("temporary files remain: %v %v", entries, err)
	}
}

func TestControlledProviderFailuresPreserveExistingFiles(t *testing.T) {
	for _, test := range []struct {
		name string
		body []byte
	}{
		{"malformed", []byte("not a PNG")},
		{"oversize", bytes.Repeat([]byte("x"), 16<<10+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			target := filepath.Join(directory, "amazon.png")
			original := []byte("existing reviewed asset")
			if err := os.WriteFile(target, original, 0o600); err != nil {
				t.Fatal(err)
			}
			const secret = "sk_cli_controlled_secret"
			const signedURL = "https://img.logo.dev/assets/cli-token?signature=cli-signed-secret"
			calls := 0
			client := &http.Client{Transport: importRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				body := []byte(`{"data":{"url":"` + signedURL + `"}}`)
				if calls == 2 {
					body = test.body
				}
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), Request: request}, nil
			})}
			var stdout, stderr bytes.Buffer
			code := runWithDependencies([]string{"--dir", directory, "--refresh", "amazon"}, &stdout, &stderr, importDependencies{
				newImporter: func(secret string) (logoImporter, error) { return businesslogos.NewLogoDevImporter(secret, client) },
				getenv:      func(string) string { return secret },
			})
			if code != 1 || calls != 2 {
				t.Fatalf("code=%d calls=%d stderr=%q", code, calls, stderr.String())
			}
			data, err := os.ReadFile(target)
			if err != nil || !bytes.Equal(data, original) {
				t.Fatalf("failed import changed existing target: %q %v", data, err)
			}
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 1 || entries[0].Name() != "amazon.png" {
				t.Fatalf("failed import left temporary files: %v %v", entries, err)
			}
			for _, forbidden := range []string{secret, signedURL, "cli-signed-secret", "img.logo.dev"} {
				if strings.Contains(stdout.String()+stderr.String(), forbidden) {
					t.Fatalf("output leaked %q: %q %q", forbidden, stdout.String(), stderr.String())
				}
			}
		})
	}
}

func TestAccountFailuresStopAllBatch(t *testing.T) {
	for _, batchErr := range []error{
		businesslogos.ErrLogoDevUnauthorized,
		businesslogos.ErrLogoDevForbidden,
		businesslogos.ErrLogoDevCredits,
		businesslogos.ErrLogoDevRateLimited,
	} {
		t.Run(batchErr.Error(), func(t *testing.T) {
			directory := t.TempDir()
			importer := &fakeLogoImporter{download: func(string) ([]byte, error) { return nil, batchErr }}
			code, stdout, stderr, _ := runImport(t, []string{"--dir", directory, "--all"}, "sk_test", importer)
			if code != 1 || stdout != "" || len(importer.calls) != 1 {
				t.Fatalf("code=%d stdout=%q calls=%v stderr=%q", code, stdout, importer.calls, stderr)
			}
			if got, want := strings.Count(stderr, "not attempted (batch stopped:"), len(businesslogos.LogoDevDomains())-1; got != want {
				t.Fatalf("not-attempted outcomes = %d, want %d", got, want)
			}
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 0 {
				t.Fatalf("failed batch wrote files: %v %v", entries, err)
			}
		})
	}
}

func TestOtherPerKeyFailuresContinue(t *testing.T) {
	directory := t.TempDir()
	importer := &fakeLogoImporter{download: func(key string) ([]byte, error) {
		switch key {
		case "amazon":
			return nil, businesslogos.ErrLogoDevIndexing
		case "kfc":
			return []byte("kfc png"), nil
		default:
			return nil, businesslogos.ErrLogoDevNotFound
		}
	}}
	code, stdout, stderr, _ := runImport(t, []string{"--dir", directory, "amazon", "kfc", "lime"}, "sk_test", importer)
	if code != 1 || !slices.Equal(importer.calls, []string{"amazon", "kfc", "lime"}) {
		t.Fatalf("code=%d calls=%v stderr=%q", code, importer.calls, stderr)
	}
	for _, key := range []string{"amazon", "kfc", "lime"} {
		if !strings.Contains(stdout+stderr, key+":") {
			t.Fatalf("missing outcome for %s: %q %q", key, stdout, stderr)
		}
	}
	if !strings.Contains(stdout, "kfc: imported") || !strings.Contains(stderr, "still indexing") || !strings.Contains(stderr, "no logo") {
		t.Fatalf("unexpected outcomes: %q %q", stdout, stderr)
	}
	if _, err := os.Stat(filepath.Join(directory, "kfc.png")); err != nil {
		t.Fatal(err)
	}
}

func TestMissingSecretStopsBeforeNetwork(t *testing.T) {
	directory := t.TempDir()
	importer := &fakeLogoImporter{download: func(string) ([]byte, error) {
		t.Fatal("missing secret reached import")
		return nil, nil
	}}
	code, stdout, stderr, factoryCalls := runImport(t, []string{"--dir", directory, "amazon", "kfc", "lime"}, "", importer)
	if code != 1 || stdout != "" || factoryCalls != 0 || len(importer.calls) != 0 {
		t.Fatalf("code=%d stdout=%q factory=%d calls=%v", code, stdout, factoryCalls, importer.calls)
	}
	if !strings.Contains(stderr, "amazon: LOGO_DEV_SECRET_KEY") || strings.Count(stderr, "not attempted") != 2 {
		t.Fatalf("outcomes = %q", stderr)
	}
}

func TestAtomicWriteFailureCleansTemporaryFile(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "amazon.png")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(target, "keep")
	if err := os.WriteFile(original, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeLogoAtomic(target, []byte("replacement")); err == nil {
		t.Fatal("replacing a directory with a file succeeded")
	}
	data, err := os.ReadFile(original)
	if err != nil || string(data) != "keep" {
		t.Fatalf("existing directory content changed: %q %v", data, err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 1 || entries[0].Name() != "amazon.png" {
		t.Fatalf("temporary files remain: %v %v", entries, err)
	}
}

func TestSymlinkTargetIsNotFollowedOrReplaced(t *testing.T) {
	directory := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directory, "amazon.png")
	if err := os.Symlink(outside, target); err != nil {
		t.Fatal(err)
	}
	importer := &fakeLogoImporter{download: func(string) ([]byte, error) {
		t.Fatal("non-regular target reached import")
		return nil, nil
	}}
	code, _, stderr, _ := runImport(t, []string{"--dir", directory, "--refresh", "amazon"}, "sk_test", importer)
	if code != 1 || !strings.Contains(stderr, "not a regular file") || len(importer.calls) != 0 {
		t.Fatalf("code=%d stderr=%q calls=%v", code, stderr, importer.calls)
	}
	data, err := os.ReadFile(outside)
	if err != nil || string(data) != "outside" {
		t.Fatalf("outside target changed: %q %v", data, err)
	}
	if info, err := os.Lstat(target); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink was replaced: %v %v", info, err)
	}
}
