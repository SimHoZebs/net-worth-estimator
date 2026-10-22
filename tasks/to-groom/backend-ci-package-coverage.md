# Backend CI: include command-package checks

CI passes `./internal/... ./cmd/...` to `backend/scripts/verify.sh`, but the script reads only its first argument. The command appears to check server/CLI packages while silently omitting them.

Use the existing no-argument invocation, `backend/scripts/verify.sh`, in CI. Its documented default is `./...`, which covers both internal and command packages without adding argument-parsing code.

- Workflow: `.github/workflows/verify.yml:13`.
- Single-argument behavior: `backend/scripts/verify.sh:3-8,16-30`.
- Existing default gate: `TESTING.md:71-81`.
- Command tests: `backend/cmd/server/main_test.go:20-33`.

Verify the selected vet/test package pattern and confirm command-package execution in CI logs. Broader coverage includes fixture commands and may expose existing failures. CI-time change remains unmeasured.
