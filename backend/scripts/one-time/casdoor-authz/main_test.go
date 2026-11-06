package main

import (
	"context"
	"encoding/json"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"os"
	"path/filepath"
	"testing"
)

func TestImportPreservesOwnersAndExplicitDenials(t *testing.T) {
	dir := t.TempDir()
	app, target, source := filepath.Join(dir, "app.db"), filepath.Join(dir, "policy.db"), filepath.Join(dir, "manifest.json")
	db, err := sqlite.SetupDatabase(app)
	if err != nil {
		t.Fatal(err)
	}
	const issuer = "https://auth.test"
	for _, subject := range []string{"owner", "guest"} {
		if _, err := db.EnsureUser(authorization.ActorKey(issuer, subject), issuer, subject); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()
	before, _ := os.ReadFile(app)
	manifest := map[string]any{"issuer": issuer, "guestSubject": "guest", "users": []map[string]any{
		{"subject": "owner", "permissions": []string{}}, {"subject": "guest", "permissions": []string{authorization.Read, authorization.Project}},
	}}
	data, _ := json.Marshal(manifest)
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := importPolicy(source, app, target); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(app)
	if string(before) != string(after) {
		t.Fatal("financial database changed")
	}
	c, err := authorization.New(authorization.Config{Issuer: issuer, GuestSubject: "guest", Path: target})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	scope, err := c.Resolve(context.Background(), "owner")
	if err != nil || len(scope.Permissions) != 0 {
		t.Fatalf("denial widened: %+v %v", scope, err)
	}
	policyBefore, _ := os.ReadFile(target)
	if err := importPolicy(source, app, target); err == nil {
		t.Fatal("existing target accepted")
	}
	policyAfter, _ := os.ReadFile(target)
	if string(policyBefore) != string(policyAfter) {
		t.Fatal("existing target changed")
	}
	manifest["users"] = []map[string]any{{"subject": "guest", "permissions": []string{authorization.Read}}}
	data, _ = json.Marshal(manifest)
	os.WriteFile(source, data, 0600)
	missing := filepath.Join(dir, "missing-owner.db")
	if err := importPolicy(source, app, missing); err == nil {
		t.Fatal("missing financial owner accepted")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("rejected import created target")
	}
}
