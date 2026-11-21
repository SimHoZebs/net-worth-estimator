---
id: 063
title: Share the release commit verification
scope: deploy-build-test
status: accepted
---

Both production release workflows carry a verbatim inline node step named "Verify the tested commit". It validates the 40-character release SHA and, on manual dispatch, queries the GitHub API for a green push-to-main `Tests` run before any release is requested. This is a security gate on production releases, and the two copies have already drifted: the Northflank copy declares `GITHUB_REPOSITORY` in its step env while the Vercel copy omits it and relies on GitHub's implicit default. A later fix to the SHA check, API query, or dispatch-ref rule applied in one file silently leaves the other gate running old logic. The smaller `code-guard` job is likewise repeated in three workflows, though its logic is already centralized in a script.

Move the shared verification into one checked-in script, for example `scripts/verify-release-sha.mjs`, that reads the event context from env and performs the SHA-format, dispatch-ref, and green-main-`Tests` checks. Replace the two inline blocks with short steps that invoke it with the same env and keep `GITHUB_REPOSITORY` consistent in both callers.

Verify with actionlint on all four workflows, then exercise both workflows with `workflow_dispatch` off main and with a non-green SHA, confirming both fail before requesting a release, and confirm a green main SHA passes both. Keep the SHA regex, the green-main-run requirement, and the dispatch-ref restriction unchanged.

References: `.github/workflows/northflank-release.yml:64-101`; `.github/workflows/vercel-release.yml:66-102`; repeated `code-guard` at `.github/workflows/images.yml:21-51`, `.github/workflows/northflank-release.yml:22-51`, `.github/workflows/vercel-release.yml:22-52`.
