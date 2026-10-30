package authorization

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"reflect"
	"testing"
)

// This opt-in check only reads an explicitly marked disposable provider. The
// fixture owner must create and seed it separately. Ordinary unit gates skip it.
func TestCasdoorAuthorizationFixture(t *testing.T) {
	path := os.Getenv("CASDOOR_AUTHORIZATION_FIXTURE")
	if path == "" {
		t.Skip("set CASDOOR_AUTHORIZATION_FIXTURE to an explicitly disposable fixture JSON file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("cannot read disposable authorization fixture")
	}
	var fixture struct {
		Disposable string `json:"disposable"`
		Settings   struct {
			PublicURL    string `json:"publicUrl"`
			ClientID     string `json:"clientId"`
			ClientSecret string `json:"clientSecret"`
		} `json:"settings"`
		Subjects struct {
			Owner  string `json:"owner"`
			Second string `json:"second"`
			Guest  string `json:"guest"`
		} `json:"subjects"`
	}
	if json.Unmarshal(data, &fixture) != nil || fixture.Disposable != "waypoint-authorization-v1" || fixture.Subjects.Owner == "" || fixture.Subjects.Second == "" || fixture.Subjects.Guest == "" || fixture.Subjects.Owner == fixture.Subjects.Second || fixture.Subjects.Owner == fixture.Subjects.Guest || fixture.Subjects.Second == fixture.Subjects.Guest {
		t.Fatal("expected an explicitly disposable authorization fixture with three distinct verified subjects")
	}
	issuer, err := url.Parse(fixture.Settings.PublicURL)
	if err != nil || (issuer.Hostname() != "localhost" && issuer.Hostname() != "127.0.0.1") || issuer.Port() == "" || issuer.Port() == "8000" {
		t.Fatal("disposable authorization checks require a separate loopback port")
	}
	config := Config{Issuer: fixture.Settings.PublicURL, ClientID: fixture.Settings.ClientID, ClientSecret: fixture.Settings.ClientSecret}
	client, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, subject := range []string{fixture.Subjects.Owner, fixture.Subjects.Second} {
		scope, err := client.Resolve(ctx, subject)
		if err != nil || scope.Resource != ResourceFor(config.Issuer, subject) || !reflect.DeepEqual(scope.Permissions, []string{Read, Project, Write}) {
			t.Fatalf("real provider did not grant the private owner scope: %+v, %v", scope, err)
		}
	}
	// Empty subjects fail closed; there is no literal guest or sample row.
	if scope, err := client.Resolve(ctx, ""); err == nil || scope.Resource.ID != "" {
		t.Fatalf("empty subject did not fail closed: %+v, %v", scope, err)
	}
	// The preprovisioned guest is an ordinary account with limited
	// creation-time grants: exactly viewer [read, project], not full write.
	guest, err := client.Resolve(ctx, fixture.Subjects.Guest)
	if err != nil || guest.Resource != ResourceFor(config.Issuer, fixture.Subjects.Guest) || !guest.Resource.valid() || !reflect.DeepEqual(guest.Permissions, []string{Read, Project}) {
		t.Fatalf("real provider did not return limited guest viewer grants: %+v, %v", guest, err)
	}
	for _, check := range []struct {
		name, subject string
		resource      Resource
	}{
		{"cross owner", fixture.Subjects.Second, ResourceFor(config.Issuer, fixture.Subjects.Owner)},
		{"guest private", fixture.Subjects.Guest, ResourceFor(config.Issuer, fixture.Subjects.Owner)},
	} {
		t.Run(check.name, func(t *testing.T) {
			decisions, err := client.Check(ctx, check.subject, check.resource, []string{Read, Project, Write})
			if err != nil || !reflect.DeepEqual(decisions, []bool{false, false, false}) {
				t.Fatalf("real provider did not deny foreign resource: %v, %v", decisions, err)
			}
		})
	}
	missing := config
	missing.ModelID = "waypoint/disposable-missing-model"
	missingClient, err := New(missing)
	if err != nil {
		t.Fatal(err)
	}
	if scope, err := missingClient.Resolve(ctx, fixture.Subjects.Owner); err != nil || len(scope.Permissions) != 0 {
		t.Fatalf("real provider zero-group response did not deny all: %+v, %v", scope, err)
	}
	invalid := config
	invalid.ClientSecret = "invalid-disposable-credential"
	invalidClient, err := New(invalid)
	if err != nil {
		t.Fatal(err)
	}
	if scope, err := invalidClient.Resolve(ctx, fixture.Subjects.Owner); err == nil || scope.Resource.ID != "" || len(scope.Permissions) != 0 {
		t.Fatalf("real provider credential error did not fail closed: %+v, %v", scope, err)
	}
}
