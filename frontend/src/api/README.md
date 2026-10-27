# Client boundary

Application requests follow this path:

1. A TanStack Query query or mutation owns the request.
2. The query or mutation calls `generated/endpoints.ts`.
3. The generated endpoint uses a mutator in `waypoint-fetch.ts`.

Only the mutator uses the browser network transport. `clientBoundary.test.ts`
checks this boundary. Scripts and HTTP test fixtures are outside this application
boundary.

`orval.config.ts` selects the transport contract per operation:

- Plan requests verify resource identity and cancel when the resource changes.
- Identity requests work before plan verification. Session discovery validates
  the returned resource and header before it accepts a session.
- Streaming requests return the live, resource-guarded `Response` to the
  stochastic query. The query owns stream parsing and progress snapshots.
- Logout returns a `Response` so local private state can clear before the
  redirect body completes.

Session discovery and logout use `auth/sessionQuery.ts`. Its QueryClient stays
separate from the plan cache because session verification must survive plan
cache cancellation. Account details and mutations use the shared server cache.

The backend publishes identity and streaming contracts in OpenAPI even though
their handlers run outside Huma. Refresh the checked-in snapshot without a
running server or financial data:

```bash
OPENAPI_SNAPSHOT="$PWD/frontend/openapi.snapshot.json" CGO_ENABLED=0 \
  go -C backend test ./internal/api -run TestRawRoutesAppearInOpenAPI -count=1
npm --prefix frontend run format -- openapi.snapshot.json
npm --prefix frontend run api:generate
```

For another identity operation or stream, add its backend contract and Orval
operation override. Then call its generated endpoint from a query or mutation.
