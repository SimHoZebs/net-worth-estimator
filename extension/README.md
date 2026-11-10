# Waypoint purchase capture

Manifest V3 extension for current desktop Chrome and Brave. Capture one optional purchase, review its full USD cost, choose a funding account and earliest date, then save directly to Waypoint. No Gemini Nano dependency.

## Install

1. Run `bun install --frozen-lockfile` and `bun --filter ./extension build`.
2. Open `chrome://extensions` or `brave://extensions`, enable Developer mode, and select **Load unpacked** then `extension/dist`.
3. Pin the extension and open it on a product page.
4. Save your HTTPS Waypoint app origin in **Connection & AI settings**, grant access to that host, and select **Connect**.
5. Approve the displayed device code on the identity-provider page.

Device sign-in must be enabled in the deployed Better Auth application; provisioning already includes the device grant type. The side panel stays alongside the merchant page, with a separate extension window as the fallback. Page access is temporary: after navigation to another origin, invoke the toolbar button again.

## Capture

**Read this page** uses bounded Product/Offer JSON-LD or product Open Graph metadata. Multiple products, offers, and price ranges do not choose a price. Use the target button beside a name or cost to select a visible element; Escape cancels, and Tab and Enter select a focused element without activating its link. Cross-origin frames, closed shadow roots, restricted browser pages, and image-only prices need manual entry.

USD is explicit; a dollar sign alone does not establish currency. Review taxes, delivery, the selected variant, and the full one-time cost. The extension never orders anything. Purchases append to the existing optional queue.

Drafts survive panel closure and browser restart. If a save's result is unknown, the form locks and **Retry the same save** resends the exact UUID and payload. The purchase API returns `409` for duplicate IDs; the extension confirms success only when the saved purchase matches the retry payload, and a different saved purchase keeps the draft locked for review. Starting another capture after an unknown result requires confirmation.

## App API

The extension is an independent client with its own manifest, dependencies, build, and tests, and it imports no frontend source. Both clients share the standalone planned-purchase API and storage. Purchases are standalone rows under their owning user, separate from transactions and recurrence rules. Priority is nonnegative and lower numbers come first.

- `GET /v1/planned-purchases` reads the queue and model revision.
- `POST /v1/planned-purchases` creates a purchase. Omitted priority appends it.
- `PATCH /v1/planned-purchases/{id}` replaces purchase values. Omitted priority preserves it.
- `DELETE /v1/planned-purchases/{id}` removes a purchase.
- `POST /v1/planned-purchases/reorder` moves `{ id, beforeId }`. Empty `beforeId` appends.

Create and update return `value/issues/saved/revision`. All writes use the normal validation, resource guard, permissions, and read-only protection. Duplicate IDs return `409`. The purchase queue document owns this contract.

Device sign-in uses `/v1/auth/device/start`, `poll`, and `refresh`; `/v1/auth/session` identifies the user and resource. The worker reads `/v1/financial-model` and `/v1/status` for funding choices, queue order, and write permission. Only eligible account IDs and names reach the panel, and the worker keeps the financial model in memory. Save uses `POST /v1/planned-purchases` with `name`, `fundingAccountId`, `cost`, `earliestDate`, `priority`, and `enabled`, exactly like the app editor. Concurrent app and extension writes use the same last-write rules.

## Optional remote AI

Configure a Chat Completions base URL, model ID, and your own API key. The provider must support `response_format: json_schema`. Use a general-purpose paid API unless your subscription provider explicitly permits this use; OpenCode Go documents coding-agent traffic, so its suitability for purchase extraction remains unconfirmed. **AI autofill** sends only product facts and at most 12,000 characters of visible text; scripts, form content, and Waypoint funding-account data are excluded. Review the source page before using AI; product text may itself contain personal information. No provider fallback, automatic AI call, telemetry, or request-body logging exists. Model output only proposes field values; it cannot save purchases, invoke tools, choose a funding account, or set a date. Manual edits survive late AI responses.

## Credentials and privacy

- App refresh credentials persist in `chrome.storage.local`, restricted to trusted extension contexts. Access tokens and AI keys use `chrome.storage.session`. Nothing uses browser sync, and merchant content scripts cannot read either store.
- Local extension storage is not an encrypted OS keychain. Protect your browser profile; a compromised profile can expose credentials and captured drafts. **Disconnect** removes local app credentials but does not revoke copied tokens; revoke compromised credentials through your identity-provider account page.
- Website logout and extension disconnect are separate sessions. The extension requests app/provider host access only after settings confirmation, and product pages use `activeTab` rather than permanent access to all browsing history.
- Source URL, timestamp, price text, variant, and field provenance stay local. Raw HTML and AI page context never enter the backend.

The backend extension transport admits POSTs only to the planned-purchase and device-auth routes from valid Chromium extension origins, drops cookies and the extension origin before the usual middleware, and preserves Fetch Metadata and all bearer, resource, and permission checks. Requests with an extension origin outside the allowed POST routes are rejected. No CORS permissions or purchase-only OAuth scope are added.

## Verify

```bash
bun install --frozen-lockfile
bun --filter ./extension test
bun --filter ./extension lint
bun --filter ./extension build
(cd extension && bunx --no-install playwright install chromium)
bun --filter ./extension test:browser
backend/scripts/verify.sh
```

Browser tests load a real extension in a disposable Chromium profile with a local HTTP fixture for the external app and provider. Go tests cover real SQLite, the purchase API, duplicate-ID responses, and the identity boundary. Real-provider sign-in, Brave, and physical passkeys need separate manual checks. If the backend predates the `planned_purchases` table, run the one-time planned-purchases upgrade before using the extension.
