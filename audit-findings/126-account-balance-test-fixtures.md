---
id: 126
title: Supply account balances directly in frontend tests
scope: deploy-build-test
status: accepted
---

The frontend test server calculates its own account balances and decides which debts are archived. Its rule archives a zero-balance liability even without payment terms; the real API requires payment terms. Frontend tests can therefore see a different account list from the one the API returns.

Use explicit balance response fixtures in the frontend test server and remove its balance replay and tests of that replay. Keep the fake's request and timing behavior. Test the balance rules through the real API.

## References

- `frontend/src/mocks/waypointServer.ts:79-181,346-350` computes test account balances and archival state.
- `frontend/src/mocks/workspace.ts:92-114` already prepares account fixture rows.
- `backend/internal/api/model/queries.go:42-52,164-215` applies the real API rules.
- `backend/internal/api/integration/query_handlers_test.go:595-624,702-809` covers the real account balance and archival behavior.

## Verification

Source comparison confirms the frontend fake and real API apply different archival rules.

Run frontend unit tests with explicit archived and active account fixtures. Run the backend account balance and archival integration tests and confirm that the frontend fake no longer duplicates the calculation.
