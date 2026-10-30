# Waypoint purchase capture

Manifest V3 extension for current desktop Chrome and Brave. Capture one optional
purchase, review its full USD cost, choose a funding account and earliest date,
then save directly to Waypoint. No Gemini Nano dependency.

## Install

1. Install dependencies with `npm --prefix extension ci`.
2. Run `npm --prefix extension run build`.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable Developer mode. Select **Load unpacked**, then `extension/dist`.
5. Pin the extension and open it on a product page.
6. Save your HTTPS Waypoint app origin in **Connection & AI settings**.
7. Grant access to that host, then select **Connect**.
8. Approve the displayed device code on the identity-provider page.

Device sign-in must be enabled in the deployed Casdoor application. Existing
instances may need the manual grant-type step in
[the Casdoor guide](../auth/casdoor/README.md#command-line-access). This extension
does not modify the identity issuer or deployment routes.

The side panel stays alongside the merchant page. A separate extension window is
the fallback when side-panel activation is unavailable. Page access is temporary:
after navigation to another origin, invoke the toolbar button again.

## Capture

**Read this page** uses bounded Product/Offer JSON-LD or product Open Graph
metadata. Multiple products, offers and price ranges do not choose a price.
Use the target button beside name or cost to select a visible element. Escape
cancels. Tab and Enter select a focused element without activating its link.
Cross-origin frames, closed shadow roots, restricted browser pages and image-only
prices need manual entry.

USD is explicit. A dollar sign alone does not establish currency. Review taxes,
delivery, the selected variant and the full one-time cost. The extension never
orders anything. Purchases append to the existing optional queue.

Drafts survive panel closure and browser restart. If a save's result is unknown,
the form locks and **Retry the same save** resends the exact UUID and payload.
The purchase API returns `409` for duplicate IDs. The extension reads the
saved model and confirms success only if that purchase matches the retry payload.
A different saved purchase keeps the draft locked for review. No new retry table
or backend idempotency subsystem exists.
Starting another capture after an unknown result requires confirmation.

## Existing app API

The extension is an independent client in this monorepo. It has its own manifest,
dependencies, build and tests. It imports no frontend source. Both clients share
the app's standalone planned-purchase API and storage.

Device sign-in uses the existing `/v1/auth/device/start`, `poll` and `refresh`
routes. `/v1/auth/session` identifies the user and resource. The worker reads
`/v1/financial-model` and `/v1/status` for funding choices, queue order and write
permission. These reads include financial data. Only eligible account IDs and
names reach the panel. The worker keeps the financial model in memory.
AI requests contain only the captured product data.

Save uses `POST /v1/planned-purchases`, exactly like the app's editor:
`name`, `fundingAccountId`, `cost`, `earliestDate`, `priority`, and `enabled`.
Purchases remain separate from postings. The app's validation and
storage remain authoritative. Concurrent app and extension writes use the same
last-write rules. Source URL, price text and variant stay in the local draft.

## Optional remote AI

Configure a Chat Completions base URL, model ID and your own API key. The provider
must support `response_format: json_schema`. Use a general-purpose paid API unless
your subscription provider explicitly permits this use. OpenCode Go documents
coding-agent traffic, so its suitability for purchase extraction remains unconfirmed.

After **Read this page**, **AI autofill** sends only product facts and at most
12,000 characters of visible text to that configured provider. Scripts, form
content and Waypoint funding-account data are excluded. Review the source page before
using AI. Product text may itself contain personal information. No provider
fallback, automatic AI call, telemetry or request-body logging exists.

Model output only proposes field values. It cannot save purchases, invoke tools,
choose a funding account or set a date. Manual edits survive late AI responses.

## Credentials and privacy

- App refresh credentials persist in `chrome.storage.local`, restricted to trusted
  extension contexts. Access tokens and AI keys use `chrome.storage.session`.
- Nothing uses browser sync. Merchant content scripts cannot read either store.
- Local extension storage is not an encrypted OS keychain. Protect your browser
  profile. A compromised profile can expose credentials and captured drafts.
- **Disconnect** removes local app credentials. It does not revoke copied tokens.
  Revoke compromised credentials through your identity-provider account page.
- Website logout and extension disconnect are separate sessions. Expired or
  revoked credentials require reconnect. No permanent socket or keepalive runs.
- The extension requests app/provider host access only after settings confirmation.
  Product pages use `activeTab`, not permanent access to all browsing history.
- Source URL, timestamp, price text, variant and field provenance stay local to
  the extension. They do not appear in the app purchase editor. Raw HTML and AI
  page context never enter the backend.

The backend already supports CLI device flow and bearer credentials. Its new
extension transport admits POSTs only to the planned-purchase and device-auth
routes from valid Chromium extension origins. These POSTs carry `Origin` despite
host permission. The transport drops cookies and that origin before the usual
middleware runs. It preserves Fetch Metadata and all bearer/resource/permission
checks. Website origin/CSRF rules stay intact. Chromium GET requests omit `Origin`
and use existing bearer handling. Requests with an extension origin outside the
allowed POST routes are rejected. No CORS permissions or new purchase-only OAuth
scope are added.

## Verify

```bash
npm --prefix extension ci
npm --prefix extension test
npm --prefix extension run lint
npm --prefix extension run build
npm --prefix extension exec playwright install chromium
npm --prefix extension run test:browser
backend/scripts/verify.sh
```

Browser tests load a real extension in a disposable Chromium profile. A local
HTTP fixture replaces only the external app/provider. Go tests cover real SQLite,
the purchase API, duplicate-ID responses and the identity boundary.
Real-provider sign-in, Brave and physical passkeys need separate manual checks.
The standalone purchase backend requires the separate one-time upgrade described
in [purchase persistence](../docs/purchase-queue.md#persistence). The extension adds
no capture-specific tables or source-evidence storage.
