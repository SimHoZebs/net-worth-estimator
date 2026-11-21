---
id: 103
title: Point release gates at the deploy recipes
scope: doc-audit-reference
status: accepted
---

The release-gates doc partially restates Deployment Guide recipes. Its image-validation line names two of the three commands in the images guide and omits the code-gate test, and its failed-release paragraph repeats a dispatch caveat more completely stated in the Northflank guide while also linking to it. Partial copies of a recipe are worse than either a full statement or a pointer.

Keep the gate-level claim and point to the images guide for the recipe. Reduce the failed-release paragraph to the release requirements plus one link to the Northflank release-window section.

Verify that a search for the image test and actionlint commands shows the recipe in its owner with a link from the gate doc.

References: `docs/release-gates.md:70-72,86-93`; `deploy/images.md:35-38`; `deploy/northflank/README.md:100-105`.
