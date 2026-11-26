# Business logos on accounts

Account icons show a recognizable business mark when the server can identify
one with confidence. The generic account-kind glyph stays the fallback for
unknown, loading, failed, and unsupported cases. Nothing about the financial
model, account kind, analysis state, or revision changes because of a logo.

## Recognition

`backend/internal/businesslogos` computes one optional, read-only
`recognizedBusinessKey` for each row of `GET /v1/accounts/balances`. It is
derived only from names already present in that response:

1. the sync link's `institution`
2. the sync link's bridge account name (`syncedName`)
3. the owner's account `name`

The first source that names a catalog business decides the result. If that
source names more than one business the result is unknown, and later sources
are not consulted. Names are normalized for case and punctuation and matched
on whole tokens; embedded substrings and partial words never match. Visa and
Mastercard are networks rather than account businesses, so they are not in
the catalog and never replace a recognized issuer on the same name. Manual
account names use the same whole-token aliases; there is no fuzzy matching,
transaction inference, network request, or account-kind mutation.

`Revision` on the balance response remains the canonical financial model's
content identity. Links and the computed key are metadata of the response, so
a link-only update changes the logo on the next read with no model write and
no revision change. Clients should treat that metadata as fresh per response.

## Supported catalog

Every supported key has one checked-in SVG and explicit aliases. Unsupported
business names resolve to unknown and keep the generic glyph.

| Catalog key | Aliases | Original source |
| --- | --- | --- |
| `american-express` | American Express, Amex | Wikimedia Commons American Express logo |
| `bank-of-america` | Bank of America | bankofamerica.com |
| `barclays` | Barclays | home.barclays |
| `chase` | Chase, JPMorgan Chase | Wikimedia Commons Chase logo |
| `discover` | Discover | Discover business resources |
| `klarna` | Klarna | klarna.design |
| `paypal` | PayPal | paypal.com |
| `venmo` | Venmo | venmo.com/about/brand |
| `wells-fargo` | Wells Fargo | wellsfargo.com/about |

The SVG files are copied unmodified from Simple Icons at pinned commit
`801eaab5b70f4933137069397ebbd2ce5f9ad56e`. Repository license
`LICENSE.md` is CC0-1.0. Original source URLs are recorded in Simple Icons'
`data/simple-icons.json` at that commit. PayPal and Venmo also publish brand
guidelines at the URLs above. CC0 covers the icon artwork only and grants no
trademark or brand-use rights. This project does not claim trademark
clearance; operators are responsible for their own use of brand marks.

Adding a business requires a verified, distributable asset, an entry in
`logoSpecs`, explicit aliases in `businesses`, catalog tests, and a provenance
row here. Never fabricate an approximation or derive a logo from transaction
descriptions.

## Asset delivery and storage

Assets are served only from a curated manifest through
`/v1/assets/business-logos/{key}`. That stable path redirects to
`/v1/assets/business-logos/{key}/{hash}`; the versioned response is immutable
and verified against the manifest digest before it is written. Content type is
fixed to `image/svg+xml` with `X-Content-Type-Options: nosniff`, explicit
width and height in the UI, conditional GET with `ETag`, and bounded payloads.
Unknown keys, stale versions, malformed paths, and read failures never reach
the store with caller-supplied object keys.

GET and HEAD on that exact catalog prefix are the only `/v1` requests exempt
from the session and resource-header boundary. These bytes are public,
catalog-only assets; user data, receipt images, writes, and every other route
keep the full authorization check. The browser loads them as same-origin
`<img>` through the existing `/v1` proxy. The Vercel edge route excludes this
prefix from the API-wide `Cache-Control: no-store` header so the versioned
asset can cache permanently.

Storage reuses the provider-neutral `blobstore.Store` interface. The server
creates a dedicated filesystem root at boot, separate from private receipt
blobs, and seeds the manifest idempotently from embedded files. No download,
user upload, admin gallery, remote provider, or per-request seeding exists.
`NET_WORTH_ESTIMATOR_ASSET_DIR` overrides the default `business-logos/`
directory beside `NET_WORTH_ESTIMATOR_DB`. The directory is created owner-only
and must stay owner-only for the adapter to open it. Keep it on persistent
storage in container deployments; the checked-in SVGs are embedded in the Go
binary, so no extra image files are needed. Test and fixture APIs use an
embedded deterministic in-memory store instead of writing the working
directory.

## Frontend behavior

`AccountIcon` keeps its outer size, colors, kind label, and savings override.
When a key is present it renders a contained decorative image with `alt=""`
and `aria-hidden="true"`. The generic glyph remains visible during loading
and after an asset error, and a changed key starts a fresh load. No new
announcement, remote URL, or account name change results from a logo.
