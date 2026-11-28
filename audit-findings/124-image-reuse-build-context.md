---
id: 124
title: Rebuild images when build exclusions change
scope: deploy-build-test
status: implemented
---

The image workflow can reuse an earlier image if none of the listed build inputs changed. The root `.dockerignore` controls which files enter the build context for all four images, but only the identity service lists it. An exclusions-only change can therefore reuse an image built with the previous file set.

Include `.dockerignore` as a shared reuse input for all four images. Extend the existing build-input contract check so the shared input and each image's Dockerfile inputs are covered.

## References

- `.github/workflows/images.yml:113-152` defines inputs and decides whether an image can be reused.
- `.dockerignore:1-20` defines the root build exclusions.
- `deploy/images.test.mjs:29-90` checks selected reuse inputs.

## Verification

Source inspection confirms that only one reuse list includes the shared exclusions file.

Verify that a diff limited to `.dockerignore` forces each image to rebuild and that an unrelated Markdown edit still allows reuse. Run the image contract tests.

Implemented in commit `26ba7dbd`.
