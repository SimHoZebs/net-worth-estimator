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

Every supported key has one checked-in asset and explicit aliases. Unsupported
business names resolve to unknown and keep the generic glyph.

| Catalog key | Aliases | Original source |
| --- | --- | --- |
| `ally` | Ally Bank, Ally Financial | Wikimedia Commons `Ally Financial.svg` |
| `american-express` | American Express, Amex | Wikimedia Commons American Express logo |
| `bank-of-america` | Bank of America | bankofamerica.com |
| `barclays` | Barclays | home.barclays |
| `bmo` | BMO, BMO Bank, BMO Harris, Bank of Montreal | Wikimedia Commons `BMO Logo.svg` |
| `capital-one` | Capital One, CapitalOne, Capital One Bank, Capital One Financial | Wikimedia Commons `Capital One logo.svg` |
| `chase` | Chase, JPMorgan Chase | Wikimedia Commons Chase logo |
| `citi` | Citi, Citibank, Citigroup, Citi Bank | Wikimedia Commons `Citi.svg` |
| `discover` | Discover | Discover business resources |
| `fidelity-investments` | Fidelity Investments, Fidelity Brokerage Services, Fidelity NetBenefits, NetBenefits; manual Fidelity brokerage/IRA/401(k) | Wikimedia Commons `Fidelity Logo.jpg` by Prodbot, CC BY-SA 4.0 |
| `klarna` | Klarna | klarna.design |
| `paypal` | PayPal | paypal.com |
| `pnc` | PNC, PNC Bank, PNC Financial Services | Wikimedia Commons `PNClogo.svg` |
| `truist` | Truist, Truist Bank, Truist Financial | Wikimedia Commons `Truist Financial logo.svg` |
| `us-bank` | US Bank, U.S. Bank, US Bancorp, U.S. Bancorp | Wikimedia Commons `US Bank logo 2023 color.svg` |
| `venmo` | Venmo | venmo.com/about/brand |
| `wells-fargo` | Wells Fargo | wellsfargo.com/about |

The nine original SVG files are copied unmodified from Simple Icons at pinned
commit `801eaab5b70f4933137069397ebbd2ce5f9ad56e`. Their repository license is
CC0-1.0. Original source URLs are recorded in Simple Icons'
`data/simple-icons.json` at that commit. PayPal and Venmo also publish brand
guidelines at the URLs above.

Seven additional US bank and financial brands
(`ally`, `bmo`, `capital-one`, `citi`, `pnc`, `truist`, `us-bank`) are derived
from pinned Wikimedia Commons PD-textlogo revisions. Every derived asset is a
static, path-only, black-on-transparent SVG with no remote references, scripts,
styles, raster images, or color fills; the UI's existing `dark:invert` produces
the light-mode presentation. Each is either a complete official wordmark or an
isolated emblem from its source, recolored to black, with the viewBox tightened
around the artwork. The exact source revision, license, and transformation are
recorded below. Public-domain status removes attribution obligations; it does not grant
trademark or brand-use rights.

| Catalog key | Pinned source revision | License | Transformation |
| --- | --- | --- | --- |
| `ally` | [Ally Financial.svg, oldid 1114077512](https://commons.wikimedia.org/w/index.php?title=File:Ally_Financial.svg&oldid=1114077512) | Public domain (PD-textlogo) | Whole lowercase wordmark path retained; purple fill replaced by black. |
| `bmo` | [BMO Logo.svg, oldid 1114078824](https://commons.wikimedia.org/w/index.php?title=File:BMO_Logo.svg&oldid=1114078824) | Public domain (PD-textlogo) | Red disc and its white M/house mark isolated from the wordmark; evenodd knockout retained; black fill. |
| `capital-one` | [Capital One logo.svg, oldid 1117832182](https://commons.wikimedia.org/w/index.php?title=File:Capital_One_logo.svg&oldid=1117832182) | Public domain (PD-textlogo) | Complete official wordmark retained, including the swoosh and its underline stroke; red and navy fills replaced by black and the viewBox tightened. |
| `citi` | [Citi.svg, oldid 1123815625](https://commons.wikimedia.org/w/index.php?title=File:Citi.svg&oldid=1123815625) | Public domain (PD-textlogo) | Complete official wordmark retained, including the red arc; source metadata removed, both fills replaced by black, and original fill rules and viewBox tightened. |
| `pnc` | [PNClogo.svg, oldid 1117265424](https://commons.wikimedia.org/w/index.php?title=File:PNClogo.svg&oldid=1117265424) | Public domain (PD-textlogo) | Orange disc mark with its white star cutouts isolated from the PNC wordmark; black fill, original winding. |
| `truist` | [Truist Financial logo.svg, oldid 1117832828](https://commons.wikimedia.org/w/index.php?title=File:Truist_Financial_logo.svg&oldid=1117832828) | Public domain (PD-textlogo) | Rounded-square T emblem isolated from the combined wordmark path; purple fill replaced by black; evenodd retained. |
| `us-bank` | [US Bank logo 2023 color.svg, oldid 1287380643](https://commons.wikimedia.org/w/index.php?title=File:US_Bank_logo_2023_color.svg&oldid=1287380643) | Public domain (PD-textlogo) | Red shield and white `us` wordmark isolated from the lockup; `us` preserved as an evenodd knockout; black fill. |

Aliases stay deliberately precise. `Capital One` requires the whole phrase or
the concatenated brand token; bare `capital` and bare `one` never match.
`Ally` is an ordinary word and needs `Ally Bank` or `Ally Financial`.
`U.S. Bank`, `US Bank`, `U.S. Bancorp`, and `US Bancorp` are all accepted after
punctuation normalization, but bare `us` and bare `bank` never match. `Citi`,
`PNC`, `BMO`, and `Truist` are distinctive tokens; `City Bank` is not `Citi`.
Card network names remain absent, and the existing one-key-or-unknown conflict
rule is unchanged.

Fidelity Investments is a derived raster asset, not a Simple Icons SVG and not
CC0. The source is [Fidelity Logo.jpg by Prodbot on Wikimedia Commons](https://commons.wikimedia.org/w/index.php?title=File:Fidelity_Logo.jpg&oldid=1290420570),
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); Wikimedia
VRT permission ticket `2019021510006954` records the copyright holder's
permission. The checked-in PNG is an adaptation: the pyramid/sun badge was
cropped from the source pixels, its white mark was converted to a black
silhouette with a transparent background, and the original colors and
wordmark were not retained. The crop and recolor are recorded in the PNG's
text metadata. This adaptation is shared under CC BY-SA 4.0. Neither source
nor adaptation grants trademark or brand-use rights, and this project claims
no trademark clearance; operators are responsible for their own use of brand
marks.

Fidelity aliases are deliberately conservative. Exact `Fidelity Investments`
and `Fidelity Brokerage Services` and `Fidelity NetBenefits` match on whole
tokens for both synced and manual names, `NetBenefits` is a distinctive
single-token alias, and manual names additionally accept Fidelity brokerage,
IRA, and 401(k) forms. The bare word `Fidelity` is never an alias because it
is shared with Fidelity Bank and Fidelity International; embedded substrings
such as `high fidelity` never match.

Adding a business requires a verified, distributable asset, an entry in
`logoSpecs` with its declared format, explicit aliases in `businesses`,
catalog tests, and a provenance row here. Never fabricate an approximation or
derive a logo from transaction descriptions.

## Asset delivery and storage

Assets are served only from a curated manifest through
`/v1/assets/business-logos/{key}`. That stable path redirects to
`/v1/assets/business-logos/{key}/{hash}`; the versioned response is immutable
and verified against the manifest digest before it is written. Content type is
fixed by the manifest's declared format, either `image/svg+xml` or `image/png`,
with `X-Content-Type-Options: nosniff`, explicit width and height in the UI,
conditional GET with `ETag`, and bounded payloads. Raster assets additionally
require a PNG signature and decodable, bounded dimensions at build time.
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
storage in container deployments; all checked-in SVGs and the Fidelity PNG are
embedded in the Go binary, so no extra image files are needed. Test and fixture
APIs use an embedded deterministic in-memory store instead of writing the
working directory.

## Frontend behavior

`AccountIcon` keeps its outer size, colors, kind label, and savings override.
When a key is present it renders a contained decorative image with `alt=""`
and `aria-hidden="true"`. The generic glyph remains visible during loading
and after an asset error, and a changed key starts a fresh load. No new
announcement, remote URL, or account name change results from a logo.
