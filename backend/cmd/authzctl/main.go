// Command authzctl provisions and changes application-owned Casbin assignments.
package main

import (
	"flag"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"log"
)

func main() {
	var config authorization.Config
	var setup bool
	var subject, role string
	flag.StringVar(&config.Path, "db", "", "policy database path")
	flag.StringVar(&config.Issuer, "issuer", "", "exact verified issuer")
	flag.StringVar(&config.GuestSubject, "guest", "", "provisioned guest subject")
	flag.BoolVar(&setup, "setup", false, "create fresh policy database")
	flag.StringVar(&subject, "subject", "", "verified immutable subject")
	flag.StringVar(&role, "role", "", "member, viewer or none")
	flag.Parse()
	if setup {
		if err := authorization.Setup(config); err != nil {
			log.Fatal(err)
		}
		return
	}
	client, err := authorization.New(config)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()
	if err := client.SetRole(subject, role); err != nil {
		log.Fatal(err)
	}
}
