package integrations

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/gmail"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// GmailID identifies the Gmail read-only receipt-discovery provider. It
// registers alongside SimpleFIN without changing the list contract.
const GmailID = "gmail"

// Gmail adapts the Gmail OAuth connection to the Provider contract. It
// reports the calling user's connection state with display-only metadata
// (account address, timestamps). Tokens never enter a snapshot.
type Gmail struct {
	store   store.Store
	service *gmail.Service
}

// NewGmail builds the Gmail provider adapter. The service may be nil
// (tests); the connections then report unconfigured, matching the
// SimpleFIN adapter behavior.
func NewGmail(st store.Store, service *gmail.Service) *Gmail {
	return &Gmail{store: st, service: service}
}

// ID returns the stable Gmail provider identifier.
func (p *Gmail) ID() string { return GmailID }

// Status snapshots the calling user's Gmail connection state. Only display
// metadata is returned; refresh and access tokens never leave the server.
// SyncConfigured reports connection plus OAuth client readiness; scan
// execution itself lands in INT-03.
func (p *Gmail) Status(_ context.Context) (Status, error) {
	credential, err := p.store.GetGmailCredential()
	if err != nil {
		return Status{}, err
	}
	status := Status{Connected: credential.Connected()}
	if status.Connected {
		status.Detail = credential.EmailAddress
		status.ConnectedAt = credential.ConnectedAt
		status.LastSyncAt = credential.LastScanAt
		if p.service != nil {
			status.SyncConfigured = p.service.Configured()
		}
	}
	return status, nil
}
