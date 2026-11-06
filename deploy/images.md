# GHCR container images

`.github/workflows/images.yml` publishes each tested `main` commit on GitHub
Actions, after the `Tests` workflow succeeds. It builds a Linux AMD64 image only
when that component changed since the last published image; otherwise it retags
the previous immutable digest. Every component still receives a
`sha-<full commit>` tag and OCI source/revision labels. A retagged image keeps
the original build's revision label while its tag records the release commit.
The workflow uses its
short-lived `GITHUB_TOKEN`, not a personal token. Every action is pinned to a
commit. No deployment credentials enter the build.

| Image | Runtime |
| --- | --- |
| `ghcr.io/simhozebs/net-worth-estimator-backend` | API and maintenance binaries |
| `ghcr.io/simhozebs/net-worth-estimator-frontend` | Nginx frontend and same-origin proxy |
| `ghcr.io/simhozebs/net-worth-estimator-auth` | Better Auth on Bun with explicit provisioning/import tools |

The auth image builds from `auth/better-auth/Dockerfile`. Its normal command never
creates or repairs identity schema. Builds can pull base images from Docker Hub. Home deployments
pull the completed GHCR images instead of building from source.

New GHCR packages start private. Set these three packages to public once in
GitHub package settings before anonymous hosts pull them. Do not use an expiring
workflow token as a production registry credential. Production pins resolved
image digests, and only advances after the complete publishing workflow succeeds.
Keep the previous digest references for rollback. Databases and runtime secrets
remain on the existing hosts. Northflank deploys the pinned backend and Better Auth
images; Vercel deploys the frontend from the gated `Tests` result.

Validate the publisher with `actionlint .github/workflows/images.yml` and
`node --test deploy/images.test.mjs`. The first successful Actions run verifies
the actual registry upload. Verify anonymous manifest access before cutover.

See [the deployment index](README.md) for the shared runtime and reverse-proxy contracts.
