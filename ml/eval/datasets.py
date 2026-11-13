"""Dataset constants, loaders, sampling, alias derivation, and the locked label-to-category mapping for the training harness."""

from __future__ import annotations

import random
import re
import shutil
import urllib.request
from collections import defaultdict
from pathlib import Path

PARQUET_NAME = "us-bank-txn-cats-v2.parquet"

PARQUET_URL = (
    "https://huggingface.co/datasets/DoDataThings/us-bank-transaction-categories-v2"
    "/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet"
)

# Dataset label -> detector kind ID. Labels without a classifier are omitted,
# meaning the correct outcome is no finding at all.
EXPECTED_KIND = {
    "Income": "income",
    "Rent": "rent",
    "Utilities": "utility",
    "Insurance": "auto-insurance",
}

MAPPED_KINDS = sorted(set(EXPECTED_KIND.values()))

# Dataset label -> category key (locked; mirrors the Go evalharness table).
# Transfer is direction-dependent (TRANSFER_IN on inflow, TRANSFER_OUT
# otherwise); labels without an entry carry no category expectation.
EXPECTED_CATEGORY = {
    "Income": "INCOME",
    "Rent": "RENT_AND_UTILITIES",
    "Utilities": "RENT_AND_UTILITIES",
    "Insurance": "GENERAL_SERVICES",
    "Mortgage": "LOAN_PAYMENTS",
    "Transfer": None,
    "Groceries": "FOOD_AND_DRINK",
    "Restaurants": "FOOD_AND_DRINK",
    "Shopping": "GENERAL_MERCHANDISE",
    "Transportation": "TRANSPORTATION",
    "Entertainment": "ENTERTAINMENT",
    "Subscription": "ENTERTAINMENT",
    "Healthcare": "MEDICAL",
    "Travel": "TRAVEL",
    "Education": "GENERAL_SERVICES",
    "Personal Care": "PERSONAL_CARE",
    "Fees": "BANK_FEES",
}

# Category keys with a dataset-mapped expectation, in display order.
# HOME_IMPROVEMENT and GOVERNMENT_AND_NON_PROFIT are exempt: no HF label
# maps to them, so they stay baseline until production feedback arrives.
CATEGORY_KINDS = [
    "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "BANK_FEES",
    "ENTERTAINMENT", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE",
    "MEDICAL", "PERSONAL_CARE", "GENERAL_SERVICES",
    "TRANSPORTATION", "TRAVEL", "RENT_AND_UTILITIES",
]

# Locked mitul label-to-category mapping (mirrors the Go evalharness table).
# Shopping & Retail rows matching the home-improvement pattern map to
# HOME_IMPROVEMENT; Entertainment & Recreation rows matching the gym pattern
# map to PERSONAL_CARE; Financial Services splits by key words (loan,
# insurance/tax, withdrawal) and every other Financial Services row DROPs
# (bare bank/investment names carry no mappable key). "Income" and
# "Transportation" collide with HF labels but map identically, so the scorer
# routes by label membership without ambiguity.
MITUL_HOME_RE = re.compile(r"\b(IKEA|HOME DEPOT|LOWES)\b", re.IGNORECASE)

MITUL_GYM_RE = re.compile(r"\b(GYM|FITNESS|PLANET FITNESS)\b", re.IGNORECASE)

MITUL_LOAN_RE = re.compile(r"\b(LOAN|MORTGAGE)\b", re.IGNORECASE)

MITUL_INS_RE = re.compile(r"\b(INSURANCE|TAX)\b", re.IGNORECASE)

MITUL_WD_RE = re.compile(r"WITHDRAWAL", re.IGNORECASE)

MITUL_LABELS = {
    "Food & Dining", "Transportation", "Shopping & Retail",
    "Entertainment & Recreation", "Healthcare & Medical",
    "Utilities & Services", "Financial Services", "Income",
    "Government & Legal", "Charity & Donations",
}

MITUL_PER_KEY = 4000


def resolve_expected_mitul(label: str, description: str) -> str:
    """Locked mitul label-to-category mapping; "" means DROP or unknown."""
    if label == "Food & Dining":
        return "FOOD_AND_DRINK"
    if label == "Transportation":
        return "TRANSPORTATION"
    if label == "Shopping & Retail":
        return (
            "HOME_IMPROVEMENT"
            if MITUL_HOME_RE.search(description)
            else "GENERAL_MERCHANDISE"
        )
    if label == "Entertainment & Recreation":
        return (
            "PERSONAL_CARE"
            if MITUL_GYM_RE.search(description)
            else "ENTERTAINMENT"
        )
    if label == "Healthcare & Medical":
        return "MEDICAL"
    if label == "Utilities & Services":
        return "RENT_AND_UTILITIES"
    if label == "Financial Services":
        if MITUL_LOAN_RE.search(description):
            return "LOAN_PAYMENTS"
        if MITUL_INS_RE.search(description):
            return "GENERAL_SERVICES"
        if MITUL_WD_RE.search(description):
            return "TRANSFER_OUT"
        return ""
    if label == "Income":
        return "INCOME"
    if label in ("Government & Legal", "Charity & Donations"):
        return "GOVERNMENT_AND_NON_PROFIT"
    return ""


def resolve_expected_category(label: str, direction: str) -> str:
    """Locked label-to-category mapping; Transfer follows the row direction."""
    if label == "Transfer":
        return "TRANSFER_IN" if direction == "inflow" else "TRANSFER_OUT"
    return EXPECTED_CATEGORY.get(label, "")

# Alias derivation: dataset categories whose merchants resolve to a provider
# signal through the real MapProviderResolver seam.
ALIAS_SIGNAL = {
    "Utilities": "utility-provider",
    "Insurance": "insurance-provider",
}

BASE_DATE = "2023-01-15"

SEED = 7

# paymentStreamText/paymentReferenceToken/recurringKey reduce a description to
# the first surviving token, so the alias key for a fixture row is the first
# token of length >= 3 that is not all digits, a reference token, or "dept".
# This mirrors backend/internal/analysis/recurring.go closely enough for exact
# MapProviderResolver keys; the harness reports the alias hit rate so any
# mismatch is visible instead of silent.
REFERENCE_TOKEN = re.compile(r"^(?:[a-z]{0,4}[0-9x]{4,}|[a-f0-9]{12,64})$")


def merchant_token(raw_description: str) -> str:
    text = raw_description
    for prefix in ("[debit]", "[credit]"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    # Trailing bank references never affect the first token; the domain-suffix
    # rule (brilliant.org -> brilliant) only splits tokens, which the generic
    # cleanup below already does.
    cleaned = re.sub(r"[^a-z0-9]", " ", text.lower())
    for token in cleaned.split():
        if len(token) < 3 or token.isdigit():
            continue
        if token == "dept" or REFERENCE_TOKEN.match(token):
            continue
        return token
    return ""


def download_parquet(cache: Path, url: str) -> Path:
    dest = cache / PARQUET_NAME
    if dest.exists():
        return dest
    cache.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(url) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out)
    tmp.rename(dest)
    return dest


def load_rows(parquet_path: Path) -> list[dict]:
    import pyarrow.parquet as pq

    table = pq.read_table(parquet_path, columns=["description", "category"])
    return [
        {"description": r["description"], "category": r["category"]}
        for r in table.to_pylist()
    ]


def sample_rows(rows: list[dict], count: int, seed: int) -> list[dict]:
    if count <= 0 or count >= len(rows):
        return list(rows)
    rng = random.Random(seed)
    by_category: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_category[row["category"]].append(row)
    per_cat = max(1, count // len(by_category))
    sampled: list[dict] = []
    for category in sorted(by_category):
        pool = by_category[category]
        rng.shuffle(pool)
        sampled.extend(pool[:per_cat])
    rng.shuffle(sampled)
    return sampled[:count]


def build_aliases(rows: list[dict]) -> list[dict]:
    aliases: dict[str, str] = {}
    for row in rows:
        signal = ALIAS_SIGNAL.get(row["category"])
        if not signal:
            continue
        token = merchant_token(row["description"])
        if token and token not in aliases:
            aliases[token] = signal
    return [{"match": m, "signal": s} for m, s in sorted(aliases.items())]


def load_moneydata(xlsx_path: Path) -> list[dict]:
    """MoneyData (Laramee, CC BY 4.0) rows mapped onto fixture schema.

    Real UK bank descriptions, real direction from the debit/credit
    columns; occurrence timing and amounts are still synthesized by the
    Go harness (documented limitation — this arm tests descriptor and
    label generalization, not timelines). Category is the mapped expected
    label so the Go expectedKinds and alias derivation work unchanged;
    mapped values are inert to source-category signals.
    """
    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit(
            "moneydata source needs openpyxl: uv run --with openpyxl ..."
        ) from exc
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Anonymized Original with Catego"]
    header = [c.value for c in next(ws.rows)]
    col = {name: i for i, name in enumerate(header)}
    hints = [
        (("WATER", "ENERGY", "GAS", "VIRGIN MEDIA", "TALKTALK", "COUNC",
          "C.TAX", "TV LICENCE"), "Utilities"),
        (("LV LIFE", "ASSURANT", "ZURICH", "AVIVA", "LVFS"), "Insurance"),
        (("PRINCIPALITY", "NATWEST", "SANTANDER", "MORTGAGE",
          "DEZREZ"), "Mortgage"),
        (("PETER ALAN",), "Rent"),
        (("SWANSEA UNI", "UNIV OF NOTTINGHAM",
          "SWANSEA UNIVERSITY"), "Income"),
    ]
    rows = []
    for record in ws.iter_rows(min_row=2, values_only=True):
        raw_desc = record[col["Transaction Description"]]
        if raw_desc is None or (isinstance(raw_desc, float) and raw_desc != raw_desc):
            continue
        desc = str(raw_desc).strip()
        if not desc:
            continue
        debit = record[col["Debit Amount"]]
        credit = record[col["Credit Amount"]]
        if debit not in (None, ""):
            prefix = "[debit]"
        elif credit not in (None, ""):
            prefix = "[credit]"
        else:
            continue
        upper = desc.upper()
        label = ""
        for substrings, mapped in hints:
            if any(s in upper for s in substrings):
                label = mapped
                break
        rows.append({"description": f"{prefix} {desc}", "category": label})
    return rows

MONEYDATASET_ID = "Laramee MoneyData (Mendeley dnxtg6n4rv, CC BY 4.0)"


def load_mitul(parquet_path: Path, per_key: int = MITUL_PER_KEY,
                seed: int = SEED) -> list[dict]:
    """Mitul transaction-categorization rows mapped onto fixture schema.

    Clean merchant-name descriptions (no bank-statement noise, no direction
    markers, no amounts); the Go harness derives direction from the label
    (Income inflow, all others outflow) and drops Financial Services rows
    with no mappable key. Sampling is per mapped key over UNIQUE
    descriptions (per_key per key, fewer only when a key exhausts uniques),
    fixed seed, keys in sorted order. Currency rides along as-is.
    """
    import pyarrow.parquet as pq

    table = pq.read_table(
        parquet_path,
        columns=["transaction_description", "category", "currency"],
    )
    pool: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
    for record in table.to_pylist():
        desc = (record["transaction_description"] or "").strip()
        if not desc:
            continue
        key = resolve_expected_mitul(record["category"], desc)
        if not key:
            continue
        if desc not in pool[key]:
            pool[key][desc] = (
                record["category"], record["currency"] or "USD",
            )
    rng = random.Random(seed)
    rows = []
    for key in sorted(pool):
        descs = sorted(pool[key])
        rng.shuffle(descs)
        for desc in descs[:per_key]:
            label, currency = pool[key][desc]
            rows.append({
                "description": desc,
                "category": label,
                "currency": currency,
            })
    return rows
