---
id: 125
title: Ship only the identity service runtime
scope: deploy-build-test
status: accepted
---

The identity service build installs all workspaces before building its sign-in assets, then copies the entire build tree into the final image. The running server serves its built public assets and imports two shared frontend recipes to render sign-in pages. One recipe uses `class-variance-authority`, currently installed as a frontend dependency.

Limit the final image to the identity service's runtime source, manifest, built public assets and shared recipes. Declare `class-variance-authority` as an identity runtime dependency and install only the dependencies needed by that runtime from the existing lockfile. Keep the shared recipes as the source for both services.

## References

- `auth/better-auth/Dockerfile:6-25` installs dependencies, builds assets and copies the build tree into the final image.
- `auth/better-auth/package.json:13-24` separates runtime and development dependencies.
- `auth/better-auth/src/server.ts:1-11,32-40` imports the runtime modules and serves the public files.
- `auth/better-auth/src/pages.ts:1-9`, `auth/better-auth/src/controls.ts:1-12`, and `frontend/src/components/ui/control-styles.ts:1-8` trace the runtime dependency on the shared recipes.

## Verification

Source inspection confirms the final copy includes the whole build tree. The final image was not built or measured.

Build and compare the images. Inspect the final filesystem for build-only files and dependencies. Cold-start the final image and verify `/healthz` and the rendered sign-in page, then run the disposable identity integration checks for sign-in, sign-out, passkeys and provider callbacks.
