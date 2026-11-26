# Merchant classification data

The server owns merchant-name classification. This directory sits beside
`backend/internal/categorization`, not under ML training data.

Authoritative components remain in Go:

- Taxonomy: `backend/internal/types/category.go`.
- Merchant fingerprinting: `backend/internal/domain/merchant_key.go`.
- Keyword policy and precedence: `backend/internal/categorization/classifier.go`.
- Judgment signals: `backend/internal/categorization/requests.go`.

`categories.json` reserves the generated lookup contract: normalized keys,
category keys, direction constraints, revision, and source references. It
contains no raw descriptions, amounts, account data, probabilities, or River
features. `provenance.json` records the generator, source versions, source
hashes, and output hash.

The future generator belongs in the backend module so it can import the
existing taxonomy and normalizer. No runtime consumer exists yet.
