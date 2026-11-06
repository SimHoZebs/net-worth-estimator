package authorization

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCasbinPersistedDecisions(t *testing.T) {
	config := Config{Issuer: "https://auth.test", Path: filepath.Join(t.TempDir(), "policy.db"), GuestSubject: "guest-subject"}
	if err := Setup(config); err != nil {
		t.Fatal(err)
	}
	c, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx := context.Background()
	guest, err := c.Resolve(ctx, config.GuestSubject)
	if err != nil || !guest.Allows(Read) || !guest.Allows(Project) || guest.Allows(Write) {
		t.Fatalf("guest: %+v %v", guest, err)
	}
	owner, err := c.Resolve(ctx, "owner")
	if err != nil || !owner.Allows(Write) {
		t.Fatalf("owner: %+v %v", owner, err)
	}
	decisions, err := c.Check(ctx, "owner", ResourceFor(config.Issuer, "other"), []string{Read, Project, Write})
	if err != nil || decisions[0] || decisions[1] || decisions[2] {
		t.Fatalf("cross-owner: %v %v", decisions, err)
	}
	if err := c.SetRole("owner", "none"); err != nil {
		t.Fatal(err)
	}
	owner, err = c.Resolve(ctx, "owner")
	if err != nil || len(owner.Permissions) != 0 {
		t.Fatalf("revocation regranted: %+v %v", owner, err)
	}
	other, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err := other.SetRole("owner", "viewer"); err != nil {
		t.Fatal(err)
	}
	owner, err = c.Resolve(ctx, "owner")
	if err != nil || !owner.Allows(Read) || owner.Allows(Write) {
		t.Fatalf("external update cached: %+v %v", owner, err)
	}
	// Explicit subject deny overrides the role's allow through Casbin.
	if _, err := c.db.Exec("INSERT INTO authorization_policies VALUES(?, 'users/*', ?, 'deny')", ActorKey(config.Issuer, "owner"), Read); err != nil {
		t.Fatal(err)
	}
	owner, err = c.Resolve(ctx, "owner")
	if err != nil || owner.Allows(Read) || !owner.Allows(Project) {
		t.Fatalf("deny precedence: %+v %v", owner, err)
	}
	if err := other.SetRole(config.GuestSubject, "member"); err != nil {
		t.Fatal(err)
	}
	guest, err = c.Resolve(ctx, config.GuestSubject)
	if err != nil || !guest.Allows(Write) {
		t.Fatalf("guest permissions were hard-coded: %+v %v", guest, err)
	}
	if err := c.SetPermissions("owner", []string{Read}); err != nil {
		t.Fatal(err)
	}
	if err := c.SetRole("owner", "none"); err != nil {
		t.Fatal(err)
	}
	owner, err = c.Resolve(ctx, "owner")
	if err != nil || len(owner.Permissions) != 0 {
		t.Fatalf("role revocation retained explicit grants: %+v %v", owner, err)
	}
}

func TestPolicyStartupNeverCreatesOrRepairs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "policy.db")
	c := Config{Issuer: "https://auth.test", Path: path, GuestSubject: "guest"}
	if _, err := New(c); err == nil {
		t.Fatal("missing database accepted")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("startup created database")
	}
	if err := Setup(c); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	if err := Setup(c); err == nil {
		t.Fatal("setup accepted existing database")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("setup modified existing policy state")
	}
	c.Issuer = "https://other.test"
	if _, err := New(c); err == nil {
		t.Fatal("wrong issuer accepted")
	}
}
