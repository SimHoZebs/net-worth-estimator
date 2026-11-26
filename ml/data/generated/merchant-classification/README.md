# Merchant classification table (not consumed at runtime)

This directory reserves the home for a deterministic merchant-name
classification table. The Go taxonomy in `backend/internal/types/category.go`
and the normalizer in `backend/internal/domain/merchant_key.go` remain
authoritative. No duplicate taxonomy lives here.

- `v1/rules.json`: generated lookup rows only (normalized keys, category keys, direction constraints, revision, source references). No raw descriptions, amounts, account data, probabilities, or River features.
- `v1/provenance.json`: generator version, source versions, source hashes, and output hash.

The generator will live in the backend module so it can import the existing
taxonomy and normalizer. Until then this placeholder records the contract
without wiring any classifier change.
