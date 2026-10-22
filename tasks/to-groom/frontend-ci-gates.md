# Frontend CI: run lint and the existing browser suite

The documented frontend gate includes lint and browser tests, but the audited CI job ran only typecheck, unit tests, and build. Save recovery, dialogs, keyboard behavior, and accessibility could fail without failing CI.

Add lint and the existing Playwright suite to the workflow. Provide Chromium and the Go toolchain. Reuse the fixture harness, which already starts a production-handler API and frontend, rather than introducing another server implementation.

- Workflow/gate: `.github/workflows/verify.yml:16-32`, `TESTING.md:39-47`.
- Existing harness: `frontend/playwright.config.ts:42-69`.
- Accessibility coverage: `frontend/tests/workspace.spec.ts:194-217,404-433`.

Repair [the failed-save interception](failed-save-browser-test.md) first. Run the real workflow and verify browser execution, accessibility assertions, and useful failure artifacts in its logs. Check that an unrelated local dev server cannot supply the wrong backend. CI duration and install cost remain unmeasured.
