---
id: 118
title: Calculate range percentiles in one place
scope: backend-domain
status: accepted
---

A newly calculated range and a range served from saved results both describe the same distribution of scenarios. They use separate formulas to estimate percentiles between samples. The formulas are mathematically equivalent, but floating-point rounding can leave slightly different values in the API response for identical samples.

Have the storage builder call the existing `domain.ComputePercentiles` helper, which sorts a copy and calculates all five percentiles. Remove its local calculation.

## References

- `backend/internal/api/projections/builder.go:1270-1293,1384-1393` calculates and reads stored percentiles.
- `backend/internal/domain/sampler.go:111-144` owns the existing sorted and unsorted helpers.
- `backend/internal/domain/stochastic_session.go:260-278` calculates percentiles for a newly computed range.

## Verification

A read-only arithmetic probe found that the two formulas can produce adjacent floating-point values. No difference in displayed currency was measured.

Verify exact equality between computed and stored API percentiles for the same samples, including a case where the current formulas produce different results. Cover empty and single-sample input in the builder.
