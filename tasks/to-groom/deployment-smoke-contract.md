# Compose smoke: test the deployed HTTP contract

The smoke script expects `/settings` to serve the app and every range response to contain progress. The deployment uses fragment navigation and explicit 404 pages. A cached range can legitimately send only its final result, so healthy deployments fail these assertions.

Assert the bundled `404` response for `/settings` and successful final-result completion for the seeded range request. Remove curl-failure suppression. These are smoke-test corrections, not reasons to change routing or require progress on cache hits.

- Stale assertions: `scripts/smoke-compose.sh:7-17`.
- Missing-page/fragment behavior: `frontend/nginx.conf.template:22-26`, `frontend/RUNNING.md:52`.
- Cache-hit response/test: `backend/internal/api/stochastic_sse.go:283-296`, `backend/internal/api/stochastic_sse_test.go:85-111`.

Run the smoke twice against a disposable seeded stack. The second request must accept a completed-result cache hit. A genuinely failed request must fail the script. This checks proxy completion, not incremental delivery timing.
