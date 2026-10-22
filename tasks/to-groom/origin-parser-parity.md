# Allowed website origins: use one parser

An origin identifies a website by scheme, host, and port. Production settings, request checks, and fixture startup currently parse origins differently. For example, production normalizes `https://APP.example.com:0443/`, while fixture startup only trims it. The parsers also disagree about an empty port suffix.

Reuse `corsOriginParts`, the existing request parser, inside `ParseAllowedOrigins`. Call `api.ParseAllowedOrigins` from fixture startup and delete its `splitOrigins` helper. Remove the formatter's unused option and return value after its sole caller uses the shared path.

- Duplicate parsing and formatter: `backend/internal/api/cors.go:160-190,237-251,282-307`.
- Fixture parser: `backend/cmd/fixtureapi/main.go:42,175-185`.
- Tests: `backend/cmd/server/main_test.go:9-17`, `backend/internal/api/cors_test.go:13-345`.

Verify production/fixture parity for host case, default ports, IPv6, empty ports, invalid ports, credentials, paths, and empty entries. Assert allowed requests, rejected requests, and browser preflight responses. Access-policy parsing is the regression risk, especially forwarded-host and exact-match behavior.
