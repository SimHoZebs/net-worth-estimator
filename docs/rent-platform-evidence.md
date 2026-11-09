# Rent platform evidence

Primary sources checked on 2026-11-09, after the shared payment-stream extraction.
These establish platform capabilities, not exact bank-statement descriptors.
The application never contacts these platforms or sends them bank evidence.

| Observed name | Primary source | Interpretation |
| --- | --- | --- |
| Bilt | [Bilt cards and BillPay](https://www.bilt.com/card), [What is Bilt?](https://support.biltrewards.com/hc/en-us/articles/15792165456525-What-is-Bilt) | High-value housing-payment signal. Now supports mortgages as well as rent and everyday card spending. Bilt alone suggests possible rent; explicit rent wording strengthens it. |
| RentCafe | [Resident services](https://www.rentcafe.com/residentservices/apartmentsforrent/userlogin.aspx) | Rent payment portal with utilities/services. Brand alone does not prove rent. |
| ClickPay | [Resident payment options](https://site.clickpay.com/for-residents/) | Collects rent, dues, maintenance, deposits, utilities and parking. |
| Zego | [Zego Pay](https://www.gozego.com/platform/zego-pay/) | Collects rent, HOA dues, utilities and other property charges. |
| AppFolio / FolioSpace | [Official resident help](https://www.appfolio.com/help/online-portal) | Rental resident portal collecting current and future bills, including full outstanding balances. |
| Buildium | [Online rent payments](https://www.buildium.com/features/online-rent-payments/) | Collects rent, association fees, bills and fees. |
| Zillow | [Rental Manager payments](https://www.zillow.com/rental-manager/collect-rent-online/) | Collects rent, utilities and security deposits. Zillow also has non-payment products. |
| Avail | [Online rent collection](https://www.avail.com/landlords/online-rent-collection) | Collects rent, deposits, move-in fees and other rental fees. |

Platform evidence is bounded by settled external outflows, recurring cadence,
amount consistency, account and currency boundaries, and explicit user review.
Mortgage, card-repayment and clearly non-rent charge descriptors exclude the
deterministic rent suggestion. Generic transfer rails such as ACH, Venmo, Zelle,
Stripe or Plaid are not rent-platform signals. A brand match alone remains
uncertain, not a confirmed classification. User answers stay owner-scoped;
the optional learner is shared within the deployment.

Limitations: this is a first recurring-payment classification, not lease
verification. Split rent, rent changes, inconsistent descriptors, and blended
property charges can fail the existing cadence/amount gate. No claim is made
that this catalog covers every platform or actual descriptor spelling.
