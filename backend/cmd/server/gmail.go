package main

import (
	"os"

	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
)

// configureGmail builds the Gmail OAuth service from the environment. Empty
// client credentials leave the service unconfigured: consent endpoints
// report 503 and the integrations list shows Gmail disconnected, so a
// deployment without Google verification never starts a consent flow.
// Production needs a verified OAuth client (INT-02 gates production on
// provider verification/privacy review, not on this change).
func configureGmail() *gmail.Service {
	return gmail.New(gmail.Config{
		ClientID:        os.Getenv("NET_WORTH_ESTIMATOR_GMAIL_CLIENT_ID"),
		ClientSecret:    os.Getenv("NET_WORTH_ESTIMATOR_GMAIL_CLIENT_SECRET"),
		RedirectURL:     os.Getenv("NET_WORTH_ESTIMATOR_GMAIL_REDIRECT_URL"),
		FrontendBaseURL: os.Getenv("NET_WORTH_ESTIMATOR_PUBLIC_URL"),
	})
}
