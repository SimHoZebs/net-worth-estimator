package main

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func TestRequiresExplicitDatabase(t *testing.T) {
	for _, args := range [][]string{nil, {"--db", ""}, {"--db", " "}, {"unexpected"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 {
			t.Fatalf("code=%d stderr=%s", code, errOut.String())
		}
		if !strings.Contains(errOut.String(), "--db") || out.Len() != 0 {
			t.Fatalf("unexpected output: %q %q", out.String(), errOut.String())
		}
	}
}

func TestNonDatabaseIsRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	var out, errOut bytes.Buffer
	if code := run([]string{"--db", path}, &out, &errOut); code != 1 {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, out.String(), errOut.String())
	}
}
