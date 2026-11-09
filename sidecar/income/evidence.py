"""River-specific evidence validation and feature engineering.

The application sends domain evidence. Scaling, categorical encoding, cold
start, and probability thresholds are private implementation details here.
"""
import hashlib
import math


def features_from_request(request):
    if not isinstance(request, dict) or request.get("kind") != "income":
        raise ValueError("an income judgment request is required")
    for key in ("id", "patternId"):
        if not isinstance(request.get(key), str) or not 1 <= len(request[key]) <= 256:
            raise ValueError(f"{key} is required")
    pattern = request.get("pattern")
    if not isinstance(pattern, dict):
        raise ValueError("pattern evidence is required")
    for key in ("merchant", "cadence", "currency"):
        if not isinstance(pattern.get(key), str) or len(pattern[key]) > 256:
            raise ValueError(f"invalid {key}")
    values = {}
    for key in ("typicalAmount", "annualizedEstimate", "cadenceDays", "amountVariation", "intervalVariation", "recencyDays"):
        value = pattern.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            raise ValueError(f"invalid {key}")
        value = float(value)
        if not math.isfinite(value) or value < 0 or value > 1e13:
            raise ValueError(f"invalid {key}")
        values[key] = value
    count = pattern.get("occurrenceCount")
    if type(count) is not int or not 2 <= count <= 1000000:
        raise ValueError("invalid occurrenceCount")
    for key in ("payrollDescriptor", "sourceCategoryIncome"):
        if type(pattern.get(key)) is not bool:
            raise ValueError(f"invalid {key}")
    samples = request.get("samples")
    if not isinstance(samples, list) or len(samples) > 3 or any(not isinstance(item, dict) for item in samples):
        raise ValueError("samples must contain at most three source observations")
    return {
        "log_annualized": math.log10(values["annualizedEstimate"] + 1) / 5,
        "annualized_n": min(values["annualizedEstimate"] / 100000, 2),
        "median_n": min(values["typicalAmount"] / 5000, 2),
        "occurrences_n": min(count / 12, 1),
        "amount_cv": min(values["amountVariation"], 2),
        "gap_cv": min(values["intervalVariation"], 2),
        "cadence_days_n": values["cadenceDays"] / 365.25,
        "descriptor_hit": float(pattern["payrollDescriptor"]),
        "category_income": float(pattern["sourceCategoryIncome"]),
        "recency_n": min(values["recencyDays"] / 90, 1),
        "currency:" + pattern["currency"]: 1,
        "cadence:" + pattern["cadence"]: 1,
        "merchant:" + hashlib.sha256(pattern["merchant"].encode()).hexdigest(): 1,
    }
