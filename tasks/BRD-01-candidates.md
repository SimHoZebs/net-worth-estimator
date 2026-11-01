# BRD-01 — Replacement product name: research and recommendation

**Date:** 2026-11-01 ("at selection time" checks)
**Base:** `origin/main` (`3d3bbfc`)
**Status:** Research complete — **user decision required before BRD-02.**

## Why rename

The current display name **Waypoint** collides with an established software
brand: HashiCorp Waypoint (open-source deploy tool since 2020,
4.7k+ GitHub stars; HCP Waypoint on HashiCorp Cloud Platform, now
transitioning into the Terraform Developer Portal). Same-namespace software
use plus the `Waypoint-Resource` / `waypoint/user-access` auth identifiers
makes the current name both a confusion risk and a weak brand. Rename the
display identity; BRD-02 explicitly keeps opaque IDs and DB keys stable.

## Fit criteria (from PRODUCT_INTENT.md, docs/TERMS.md, docs/UI_UX_PRINCIPLES.md)

- Plain-outcome language: position, base case, range, shortfall, goal.
- Single-household planner; no specialist jargon; recognition over reading.
- Short, memorable, distinct; no negative connotation; works as `name · Page`
  document titles and a `name.` wordmark in the style of `Brand.tsx`.

## Candidate table (11 names screened)

| # | Candidate | Rationale | .com | .app | .co | Conflicts (2026-11-01) |
|---|-----------|-----------|------|------|-----|------------------------|
| 1 | **Nedon** | Short invented word; no dictionary meaning to fight; carries the existing Notion note forward | Taken (1996, Key-Systems) | Taken (Cloudflare) | **Likely available** (NXDOMAIN, no NS/SOA) | None found: only a surname and an EU fluid-simulation research acronym; no finance/fintech use, no TM hit |
| 2 | **Plumbline** | A plumb line finds true vertical — "true position" metaphor for recorded-vs-modeled honesty (§4, §5.1) | Taken (1999, parked) | Taken | Taken (parked) | No finance collision; crowding only in trades/home-services (plumbers, fixtures) |
| 3 | **Outyear** | Budgeting term for a future fiscal year — forward-projection metaphor (§5.2) | Taken (2015, parked/squatter NS, exp. 2027) | DNS-clear, RDAP unverified | DNS-clear, RDAP unverified | Weak: Outyear Capital Management (1-person investment partnership, outyear.io); "out-year" is a generic finance term (weak distinctiveness) |
| 4 | Lodestar | Guiding-star destination metaphor | Taken (1992) | Taken | Taken | **Reject:** Lodestar Private AM ($1.3B), Lodestar Financial, **Lodestar Wealth AI personal-finance app** (direct overlap) |
| 5 | Cairn | Trail-marker metaphor for milestones (§5.4) | Taken (1995) | Taken | Taken | **Reject:** Cairn serverless personal-finance app (direct collision), Cairn Financial Group/Advisers |
| 6 | Fathom | Depth-measurement metaphor for understanding position + uncertainty (§5.3) | Taken (1995) | Taken (held by incumbent) | Taken | **Reject (blocking):** Fathom financial reporting/forecasting software (same industry) + Fathom AI notetaker ($17M) |
| 7 | Ballast | Stability metaphor | Taken (1995, live $3B+ RE investment platform) | Taken | Taken | **Reject:** Ballast platform owns exact .com; "Ballast: Invest Wisely" iOS app; Ballast Advisors/Group |
| 8 | Highwater | High-water-mark (net-worth peak) metaphor | Taken (2002, parked) | Taken | Taken | **Reject:** HighWater Wealth (San Diego HNW), Highwater Wealth Group, Glendale CO firm; term is generic in finance |
| 9 | Daymark | Nautical guide-marker metaphor | Taken (1995) | Taken (live productivity app) | Taken | **Reject:** DayMark Wealth Partners RIA (finance iOS app); DayMark Safety registered marks |
| 10 | Granary | Household-store metaphor | Taken (1994) | Taken | Taken | **Reject:** Granary Finance DeFi protocol ($5M raise); Hovis "Granary" UK TM |
| 11 | Tiller | Steering metaphor | Taken (1996, live site) | Taken | Taken | **Reject (disqualifying):** Tiller Money — spreadsheet personal-finance service with net-worth tracking (direct competitor since 2014) |

Screened out on domains alone (all three TLDs resolve; no TM pass run):
Truehold, Headroom, Leeway.

**Method:** `nslookup`/DNS for .com/.app/.co; Verisign RDAP 200 = taken
(404 = unregistered) for .com; Google `.app` RDAP endpoint unreachable on
2026-11-01, so .app/.co verdicts rest on DNS + websearch. TM/conflict pass =
websearch `<name> finance OR fintech OR app` + `<name> trademark`.

## Shortlist

1. **Nedon → nedon.co** (recommended). Only candidate with an obtainable
   exact-match primary domain and a clean conflict slate.
2. **Plumbline** (fallback). Conflict-clean in finance, but every exact-match
   domain is taken/parked; needs a modified domain (`getplumbline.*`,
   `plumblinehq.*` — not yet checked) and a second-round availability pass.
3. **Outyear** (second fallback). `.app`/`.co` DNS-clear but RDAP-unverified;
   carries a tiny same-industry namesake and generic-term weakness.

## Recommendation

Approve **Nedon** with primary domain **nedon.co**. It is the only name that
passes both gates (obtainable domain + no obvious conflict), is the shortest
and most brandable of the clean names, and continues the Notion thread rather
than starting a third naming round. (`nedon.xyz` rechecked 2026-11-01: taken,
parking IPs — confirms the original note.)

## Questions for the user (blocking BRD-02)

1. Approve **Nedon** as the product name? (Recommended: yes.)
2. Approve **nedon.co** as the primary domain (hand-register; exact-match
   .com/.app unavailable)? If not, state preference: modified-domain
   Plumbline, Outyear `.app`/`.co` (needs registrar verification first), or a
   fresh round.
3. Budget/route for acquisition: hand-registration only, or may we inquire
   about parked squatter domains (outyear.com, plumbline.com)?
4. Require trademark-counsel clearance before BRD-02 applies the name to UI,
   OAuth callbacks, and deployment identity?

**BRD-02 is blocked until the name and primary domain are approved above.**
No code, OAuth callback, or deployment-identity change was made in this task.
