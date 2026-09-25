# Waypoint

A household financial planning frontend with a local fixture mode and a same-origin Go backend mode.

## Run

Use Node.js 24 or newer. The default build uses server mode and expects the Go API on `127.0.0.1:8787`. From the repository root, start the backend with the frontend bundle available:

```sh
npm --prefix waypoint-frontend ci
npm --prefix waypoint-frontend run build
NET_WORTH_ESTIMATOR_DB=/tmp/net-worth-estimator.db \
NET_WORTH_ESTIMATOR_MODEL_PATH="$PWD/public/configs" \
NET_WORTH_ESTIMATOR_INCOME_PATH="$PWD/public/data/income" \
NET_WORTH_ESTIMATOR_FRONTEND_PATH="$PWD/waypoint-frontend/dist" \
CGO_ENABLED=0 go -C backend run ./cmd/server
```

The production server serves the frontend and API together on port `8787`. During frontend development, run the backend separately and use the Vite proxy:

```sh
cd waypoint-frontend
VITE_WAYPOINT_MODE=server npm run dev
```

The development server uses port `5178` and proxies `/v1` to `http://127.0.0.1:8787`. The fixture suite uses the same UI with explicitly selected local data:

```sh
VITE_WAYPOINT_MODE=fixture npm run dev
```

Production assets are generated in `dist/`. A static host can serve `dist/` directly when the API is same-origin or configured through `window.__WAYPOINT_CONFIG__`. Navigation uses URL fragments, so server-side route rewrites are unnecessary. Fonts and the scenario worker are served with the application. There are no external font, analytics, or bank requests.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run build
VITE_WAYPOINT_MODE=fixture npm run test:browser
TEST_PRODUCTION=1 VITE_WAYPOINT_MODE=fixture npm run test:browser
```

Browser tests cover plan editing, persistent drafts, deliberate save and discard, import validation, read-only sources, corrupt storage, storage failures, cross-tab protection, comparison snapshots, export, scenario failures, keyboard navigation, responsive layouts, and automated WCAG accessibility checks. Screenshots are written under `test-results/`.

## Workspace and data

- Fixture mode starts with an explicitly labeled illustrative household and stores plans under `waypoint.workspace.v1`.
- Server mode loads the canonical model from the Go API. Temporary versions and recovery snapshots stay in this browser under `waypoint.remote-workspace.v1` until an explicit save or discard.
- Applying a form creates or changes a temporary version. Saving explicitly replaces the saved plan; discarding explicitly restores it.
- A failed storage write retains the in-memory temporary version and offers export. A stale browser tab cannot overwrite a newer stored workspace.
- A server draft is also protected by the model content identity returned by the API. A concurrent server change blocks the save and preserves the draft for explicit recovery.
- Read-only plans allow experimentation and export. Saving back to the read-only source is disabled. Source-owned read-only records cannot be edited or removed.
- Imports accept a version 1 Waypoint plan JSON file, validate its structure and account references, and show a preview before replacement. Export the example plan to obtain a complete format reference.
- Plan exports can be imported. Full workspace backups also contain the saved state, temporary version, and comparison measures; their individual `saved` or `draft` plan can be extracted for import.
- Comparison snapshots store descriptive measures and their context. They do not contain another plan or offer plan restoration.

## Account transactions

Click an account on the outlook or its name in the plan to open its transaction history. Recorded movements and dated base-case occurrences are labeled separately. Transfers show the other account and their incoming or outgoing direction from the selected account's perspective.

Search by transaction name, other account, or date. Filter by recorded/projected status, direction, or an upcoming date window, and page through the full projection horizon. Expand a transaction to inspect requested and funded amounts, shortfalls, and the source movement. Editing that movement returns to the account view and preserves the saved plan until an explicit save.

The list contains the records available in the plan; it does not establish complete bank history. Growth and interest remain part of balance projections rather than appearing as invented recorded transactions. Zero-value scheduled debt payments after payoff are omitted. Excluded recorded movements remain visible and labeled.

## Calculation boundaries

Fixture mode uses the independent local calculation model for its illustrative workspace. Server mode sends the canonical model and income snapshot to the Go backend for deterministic and stochastic projections; the frontend maps those results for display and keeps local edits as a temporary review layer.

The base case compounds account rates between dated movements. Monthly and yearly schedules preserve their intended day, clamped to month end where needed. Amount increases apply on schedule anniversaries. Protected balances limit withdrawals, account ceilings limit incoming movements, and debt payments stop at zero.

Starting balances establish the projection boundary. Older balance checks are carried forward unchanged. Historical recorded movements are evidence only; replaying them would count money already included in starting balances twice.

The optional range uses 400 repeatable scenarios. Each calendar year shares one normally sampled market shock across investment accounts. Investment rates are capped between −50% and +50%; cash, property, and debt rates are fixed. The displayed band is the 10th to 90th percentile, with a separately calculated median. Inflation is used only for the optional today's-dollars chart; each movement has its own nominal annual increase.

Goals check the first crossing of a net-worth or account-balance target. They do not implement financial-independence or retirement-sustainability evaluations. Taxes, fees, withdrawal eligibility, legal limits and unplanned events require additional model support or explicit plan movements. Cash timing is not a safe-to-spend recommendation. An underfunded movement is neither borrowed nor rescheduled automatically.

Income evidence uses recorded, enabled one-time external inflows. Similar amounts and a monthly cadence can support a provisional annualized estimate. It does not independently establish a payer, payroll status, gross salary or bank provenance, and it never changes planned income.

## Structure

- `src/domain/`: validated plan types, example data, local fixture projections, scenario ranges and income evidence.
- `src/api/`: backend contracts, same-origin client, SSE parsing and display/document adapters.
- `src/state/`: browser persistence, remote hydration, conditional saves and worker-backed calculation state.
- `src/components/`: accessible controls, evidence dialogs, editing forms and visualization.
- `src/pages/`: outlook, plan maintenance, goals, comparison and sources.
- `tests/`: browser workflows and accessibility checks.

The frontend is part of the repository and uses the Go API in server mode; fixture mode remains available for isolated UI work.
