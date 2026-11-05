# GHCR container images

`.github/workflows/images.yml` builds each `main` commit once on GitHub Actions.
It publishes Linux AMD64 images with `sha-<full commit>` tags and OCI source/revision
labels. The workflow uses its short-lived `GITHUB_TOKEN`, not a personal token.
Every action is pinned to a commit. No deployment credentials enter the build.

| Image | Runtime |
| --- | --- |
| `ghcr.io/simhozebs/net-worth-estimator-backend` | API and maintenance binaries |
| `ghcr.io/simhozebs/net-worth-estimator-frontend` | Nginx frontend and same-origin proxy |
| `ghcr.io/simhozebs/net-worth-estimator-casdoor-upstream` | Pinned Casdoor runtime for the home stack |

The Casdoor mirror preserves the upstream command and files. The default
`auth/casdoor/Dockerfile` target still provides the separate environment-rendered
Northflank wrapper. Builds can pull upstream base images from Docker Hub. Home
deployments pull the completed GHCR images instead of building from source.

New GHCR packages start private. Set these three packages to public once in
GitHub package settings before anonymous hosts pull them. Do not use an expiring
workflow token as a production registry credential. Production pins resolved
image digests, and only advances after the complete publishing workflow succeeds.
Keep the previous digest references for rollback. Databases and runtime secrets
remain on the existing hosts. Vercel and Northflank each deploy from the gated
`Tests` result for the pushed `main` commit.

Validate the publisher with `actionlint .github/workflows/images.yml` and
`node --test deploy/images.test.mjs`. The first successful Actions run verifies
the actual registry upload. Verify anonymous manifest access before cutover.

See [the deployment index](README.md) for the shared runtime and reverse-proxy contracts.
