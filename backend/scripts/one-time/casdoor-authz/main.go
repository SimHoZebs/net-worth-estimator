// One-time import of reviewed effective Casdoor grants into application Casbin.
// The financial database is read-only. Runtime and normal setup never import this.
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

type manifest struct {
	Issuer       string `json:"issuer"`
	GuestSubject string `json:"guestSubject"`
	Users        []struct {
		Subject     string   `json:"subject"`
		Permissions []string `json:"permissions"`
	} `json:"users"`
}

func importPolicy(source, appPath, target string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	var input manifest
	if err := json.Unmarshal(data, &input); err != nil {
		return err
	}
	if input.Issuer == "" || input.GuestSubject == "" || len(input.Users) == 0 {
		return errors.New("manifest identity is incomplete")
	}
	users := map[string]bool{}
	for _, user := range input.Users {
		if user.Subject == "" || users[user.Subject] {
			return errors.New("missing or duplicate subject")
		}
		users[user.Subject] = true
		for _, action := range user.Permissions {
			if action != authorization.Read && action != authorization.Project && action != authorization.Write {
				return errors.New("unknown permission")
			}
		}
	}
	if !users[input.GuestSubject] {
		return errors.New("guest is absent from import")
	}
	uri := &url.URL{Scheme: "file", Path: appPath, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.Query("SELECT issuer, subject FROM users")
	if err != nil {
		return err
	}
	for rows.Next() {
		var issuer, subject string
		if err := rows.Scan(&issuer, &subject); err != nil {
			rows.Close()
			return err
		}
		if issuer != input.Issuer || !users[subject] {
			rows.Close()
			return errors.New("manifest does not preserve every existing financial owner")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// Build privately beside the target, then publish with an exclusive link.
	// A rejected import cannot expose a partially populated policy database.
	if _, err := os.Stat(target); err == nil {
		return errors.New("policy destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	work, err := os.MkdirTemp(filepath.Dir(target), ".authz-import-")
	if err != nil {
		return err
	}
	path := filepath.Join(work, "policy.db")
	defer os.Remove(work)
	defer os.Remove(path)
	config := authorization.Config{Issuer: input.Issuer, GuestSubject: input.GuestSubject, Path: path}
	if err := authorization.Setup(config); err != nil {
		return err
	}
	c, err := authorization.New(config)
	if err != nil {
		return err
	}
	defer c.Close()
	for _, user := range input.Users {
		if err := c.SetPermissions(user.Subject, user.Permissions); err != nil {
			return err
		}
	}
	if err := c.Close(); err != nil {
		return err
	}
	return os.Link(path, target)
}

func main() {
	var source, app, target string
	flag.StringVar(&source, "manifest", "", "reviewed manifest used by identity import")
	flag.StringVar(&app, "app-db", "", "absolute path to stopped financial database")
	flag.StringVar(&target, "db", "", "new policy database path")
	flag.Parse()
	if source == "" || app == "" || target == "" {
		log.Fatal("manifest, app-db and db are required")
	}
	if err := importPolicy(source, app, target); err != nil {
		log.Fatal(err)
	}
	fmt.Println("Policy import complete. Financial ownership and rows remain unchanged.")
}
