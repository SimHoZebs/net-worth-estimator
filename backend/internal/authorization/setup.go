package authorization

import (
	"database/sql"
	"errors"
	"os"
)

var defaultRoles = map[string][]string{
	"member": {Read, Project, Write},
	"viewer": {Read, Project},
	"none":   {},
}

// Setup creates fresh policy state only. Existing databases require the
// explicit one-time import tool, never an upgrade in normal setup or startup.
func Setup(config Config) error {
	if config.Issuer == "" || config.Path == "" || !validSubject(config.GuestSubject) {
		return errors.New("authorization issuer, database and guest subject are required")
	}
	f, err := os.OpenFile(config.Path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	f.Close()
	db, err := sql.Open("sqlite", config.Path)
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, statement := range []string{
		`CREATE TABLE authorization_config(id INTEGER PRIMARY KEY CHECK(id=1), issuer TEXT NOT NULL, guest_subject TEXT NOT NULL)`,
		`CREATE TABLE authorization_roles(name TEXT PRIMARY KEY)`,
		`CREATE TABLE authorization_subjects(actor TEXT PRIMARY KEY, role TEXT NOT NULL REFERENCES authorization_roles(name))`,
		`CREATE TABLE authorization_policies(subject TEXT NOT NULL, object TEXT NOT NULL, action TEXT NOT NULL, effect TEXT NOT NULL CHECK(effect IN ('allow','deny')), PRIMARY KEY(subject,object,action,effect))`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("INSERT INTO authorization_config VALUES(1, ?, ?)", config.Issuer, config.GuestSubject); err != nil {
		return err
	}
	for role, permissions := range defaultRoles {
		if _, err := tx.Exec("INSERT INTO authorization_roles VALUES(?)", role); err != nil {
			return err
		}
		for _, action := range permissions {
			if _, err := tx.Exec("INSERT INTO authorization_policies VALUES(?, 'users/*', ?, 'allow')", role, action); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec("INSERT INTO authorization_subjects VALUES(?, 'viewer')", ActorKey(config.Issuer, config.GuestSubject)); err != nil {
		return err
	}
	return tx.Commit()
}

// SetRole persists administrator intent, including explicit denial. It never
// removes the assignment, because removal would permit first-access enrollment.
func (c *Client) SetRole(subject, role string) error {
	if !validSubject(subject) || role == "" {
		return errors.New("invalid subject or role")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	actor := ActorKey(c.config.Issuer, subject)
	if _, err := tx.Exec("DELETE FROM authorization_policies WHERE subject=?", actor); err != nil {
		return err
	}
	if _, err := tx.Exec("INSERT INTO authorization_subjects VALUES(?, ?) ON CONFLICT(actor) DO UPDATE SET role=excluded.role", actor, role); err != nil {
		return err
	}
	return tx.Commit()
}

// SetPermissions installs an explicit assignment. A persistent none role
// prevents first-access defaults from replacing an administrator's choice.
func (c *Client) SetPermissions(subject string, permissions []string) error {
	if !validSubject(subject) {
		return errors.New("invalid authorization subject")
	}
	for _, action := range permissions {
		if action != Read && action != Project && action != Write {
			return errors.New("unknown authorization action")
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	actor := ActorKey(c.config.Issuer, subject)
	if _, err := tx.Exec("INSERT INTO authorization_subjects VALUES(?, 'none') ON CONFLICT(actor) DO UPDATE SET role='none'", actor); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM authorization_policies WHERE subject=?", actor); err != nil {
		return err
	}
	for _, action := range permissions {
		if _, err := tx.Exec("INSERT OR IGNORE INTO authorization_policies VALUES(?, 'users/*', ?, 'allow')", actor, action); err != nil {
			return err
		}
	}
	return tx.Commit()
}
