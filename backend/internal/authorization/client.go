package authorization

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	_ "modernc.org/sqlite"
)

// Policies belong to the application, not the identity provider. The stable
// actor is issuer+subject. Mutable usernames never enter policy decisions.
const userModel = `[request_definition]
r = sub, obj, act, owner
[policy_definition]
p = sub, obj, act, eft
[role_definition]
g = _, _
[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))
[matchers]
m = g(r.sub, p.sub) && r.sub == r.owner && keyMatch(r.obj, p.obj) && r.act == p.act
`

type Config struct {
	Issuer, Path, GuestSubject string
}

type Client struct {
	config Config
	db     *sql.DB
	mu     sync.Mutex
}

// New opens only an explicitly provisioned policy database. Missing or
// incompatible state fails closed. Every decision loads fresh persisted policy.
func New(config Config) (*Client, error) {
	if config.Issuer == "" || config.Path == "" || config.GuestSubject == "" {
		return nil, errors.New("authorization issuer, policy database and guest subject are required")
	}
	if _, err := os.Stat(config.Path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", config.Path+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	c := &Client{config: config, db: db}
	var issuer, guest string
	if err := db.QueryRow("SELECT issuer, guest_subject FROM authorization_config WHERE id = 1").Scan(&issuer, &guest); err != nil || issuer != config.Issuer || guest != config.GuestSubject {
		db.Close()
		return nil, errors.New("authorization database identity does not match configuration")
	}
	if _, err := c.load(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return c, nil
}

func (c *Client) Close() error { return c.db.Close() }

func (c *Client) load(ctx context.Context) (*casbin.Enforcer, error) {
	m, err := model.NewModelFromString(userModel)
	if err != nil {
		return nil, err
	}
	e, err := casbin.NewEnforcer(m)
	if err != nil {
		return nil, err
	}
	rows, err := c.db.QueryContext(ctx, "SELECT subject, object, action, effect FROM authorization_policies ORDER BY subject, object, action, effect")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sub, obj, act, effect string
		if err := rows.Scan(&sub, &obj, &act, &effect); err != nil {
			rows.Close()
			return nil, err
		}
		if _, err := e.AddPolicy(sub, obj, act, effect); err != nil {
			rows.Close()
			return nil, err
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = c.db.QueryContext(ctx, "SELECT actor, role FROM authorization_subjects WHERE role IN (SELECT name FROM authorization_roles) ORDER BY actor")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var actor, role string
		if err := rows.Scan(&actor, &role); err != nil {
			return nil, err
		}
		if _, err := e.AddGroupingPolicy(actor, role); err != nil {
			return nil, err
		}
	}
	return e, rows.Err()
}

func validSubject(subject string) bool {
	return subject != "" && strings.TrimSpace(subject) == subject && !strings.ContainsAny(subject, "\x00\r\n/")
}

// Resolve receives only a verified identity (or the configured guest). First
// access records member assignment once. An explicit none/viewer assignment
// remains authoritative on every later login, so revocation never regrants.
func (c *Client) Resolve(ctx context.Context, subject string) (Scope, error) {
	resource := ResourceFor(c.config.Issuer, subject)
	if !validSubject(subject) {
		return Scope{}, errors.New("invalid authorization subject")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	role := "member"
	if subject == c.config.GuestSubject {
		role = "viewer"
	}
	if _, err := c.db.ExecContext(ctx, "INSERT INTO authorization_subjects(actor, role) VALUES (?, ?) ON CONFLICT(actor) DO NOTHING", ActorKey(c.config.Issuer, subject), role); err != nil {
		return Scope{}, err
	}
	e, err := c.load(ctx)
	if err != nil {
		return Scope{}, err
	}
	scope := Scope{Resource: resource, Permissions: []string{}}
	for _, action := range []string{Read, Project, Write} {
		allowed, err := e.Enforce(resource.Owner, resource.ID, action, resource.Owner)
		if err != nil {
			return Scope{}, err
		}
		if allowed {
			scope.Permissions = append(scope.Permissions, action)
		}
	}
	return scope, nil
}

func (c *Client) Check(ctx context.Context, subject string, resource Resource, actions []string) ([]bool, error) {
	if !validSubject(subject) || !resource.valid() || len(actions) == 0 {
		return nil, errors.New("invalid authorization request")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, err := c.load(ctx)
	if err != nil {
		return nil, err
	}
	decisions := make([]bool, len(actions))
	for i, action := range actions {
		if action != Read && action != Project && action != Write {
			return nil, errors.New("unknown authorization action")
		}
		decisions[i], err = e.Enforce(ActorKey(c.config.Issuer, subject), resource.ID, action, resource.Owner)
		if err != nil {
			return nil, err
		}
	}
	return decisions, nil
}
