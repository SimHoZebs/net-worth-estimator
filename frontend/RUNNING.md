# Waypoint

A household financial planning frontend backed by the Go API.

## Run

Use Node.js 24 or newer. The frontend runs in local development against the Go API at `127.0.0.1:8787`. From the repository root, start the backend:

```sh
# Local state comes from a database backup, never the shipped CSVs: copy a
# backup to the dev database path while the server is stopped. tmp/ is
# gitignored and survives reboot, unlike /tmp.
cp <backup>.db tmp/net-worth-estimator.db
NET_WORTH_ESTIMATOR_DB=$PWD/tmp/net-worth-estimator.db \
CGO_ENABLED=0 go -C backend run ./cmd/server
```

Start the Vite frontend in a second terminal:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

The development server uses port `5178` and proxies `/v1` to the backend named by `NET_WORTH_ESTIMATOR_BACKEND` (default `http://127.0.0.1:8787`).

## Production build and containers

Build static assets with a build-time API origin when the frontend is hosted separately:

```sh
VITE_API_BASE_URL=https://api.example.com npm --prefix frontend run build
```

The API base resolves in this order: `window.__WAYPOINT_CONFIG__`, `VITE_API_BASE_URL`, then same-origin `/v1`. Runtime configuration must be installed before the application bundle loads.

Build the separate images from the repository root:

```sh
docker build -f backend/Dockerfile -t net-worth-estimator-backend .
docker build -f frontend/Dockerfile -t net-worth-estimator-frontend .
```

Or run the complete split stack with Compose:

```sh
docker compose up --build
```

Compose publishes the frontend at `http://localhost:8080` and the API at `http://localhost:8787`. The frontend container proxies `/v1` to `BACKEND_URL` and preserves long-running stochastic SSE responses.

Navigation uses URL fragments, so a static host does not need SPA route rewrites. Fonts and the scenario worker are served with the application. There are no external font, analytics, or bank requests.

## Workspace and data

- Browser tests run against the fixtureapi harness, which serves the real API from a recorded CSV fixture.
- Server mode loads the canonical model from the Go API. Temporary versions and recovery snapshots stay in this browser under `waypoint.remote-workspace.v1` until an explicit save or discard.
- Applying a form creates or changes a temporary version. Saving explicitly replaces the saved plan; discarding explicitly restores it.
- A failed storage write retains the in-memory temporary version and offers export. A stale browser tab cannot overwrite a newer stored workspace.
- A server draft is also protected by the model content identity returned by the API. A concurrent server change blocks the save and preserves the draft for explicit recovery.
- Read-only plans allow experimentation and export. Saving back to the read-only source is disabled. Source-owned read-only records cannot be edited or removed.
- Imports accept a version 1 Waypoint plan JSON file, validate its structure and account references, and show a preview before replacement. Export the example plan to obtain a complete format reference.
- Plan exports can be imported. Full workspace backups also contain the saved state and the temporary version; their individual `saved` or `draft` plan can be extracted for import.

## Account transactions

Click an account on the outlook or its name in the plan to open its transaction history. Recorded movements and dated base-case occurrences are labeled separately. Transfers show the other account and their incoming or outgoing direction from the selected account's perspective.

Search by transaction name, other account, or date. Filter by recorded/projected status, direction, or an upcoming date window, and page through the full projection horizon. Expand a transaction to inspect requested and funded amounts, shortfalls, and the source movement. Editing that movement returns to the account view and preserves the saved plan until an explicit save.

The list contains the records available in the plan; it does not establish complete bank history. Growth and interest remain part of balance projections rather than appearing as invented recorded transactions. Zero-value scheduled debt payments after payoff are omitted. Excluded recorded movements remain visible and labeled.

## Calculation boundaries

The canonical model and income snapshot go to the Go backend for projections; the frontend maps results for display and keeps local edits as a temporary review layer.

## Structure

- `src/domain/`: validated plan types, derived views, scenario ranges and income evidence.
- `src/api/`: backend contracts, same-origin client, SSE parsing and display/document adapters.
- `src/state/`: browser persistence, remote hydration, conditional saves and projection state.
- `src/components/`: accessible controls, evidence dialogs, editing forms and visualization.
- `src/pages/`: outlook, accounts, transactions, evaluations and configs (sources).
- `tests/`: browser workflows and accessibility checks.

The frontend is part of the repository and always uses the Go API.
