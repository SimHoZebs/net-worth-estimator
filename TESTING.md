# TESTING.md - Net Worth Estimator

## Real-data testing

This machine doubles as prod. To verify against real data instead of fixtures:

- Backend: `CGO_ENABLED=0` is required (no libc headers here). The default
  DB path under `~/.config` is root-owned and unwritable, so pass an explicit
  DB: `NET_WORTH_ESTIMATOR_DB=/tmp/nwe-<name>.db CGO_ENABLED=0 go run
  ./cmd/server` from `backend/` (model/income seed from `public/` by default).
- Frontend: `npm run dev` proxies `/v1` to `:8787`. For a separate-origin
  backend, set `VITE_API_BASE_URL` and add the browser origin to the server's
  `NET_WORTH_ESTIMATOR_ALLOWED_ORIGINS`.
- Writes go to the canonical model. For read-only poking, set
  `NET_WORTH_ESTIMATOR_READ_ONLY=1` (server rejects `PUT` with 403) or back
  up the DB file first. Auth-guarded servers need the token from Settings →
  Access, which the browser sends as a bearer header on save only.

## UI end-state verification

- Dump each route's visible text
  (`document.getElementById("main-content").innerText` via Playwright) and
  read every line; screenshots alone miss copy.
- `src/pages/copyAudit.test.tsx` fails the build on known-banned phrases —
  extend its list when cutting copy.
