"""River-specific evidence validation and feature engineering.

The application sends domain evidence. Scaling, categorical encoding, cold
start, and probability thresholds are private implementation details here.
"""
import hashlib
import math


def features_from_request(request):
    if not isinstance(request, dict) or not isinstance(request.get("kind"), str) or not 1 <= len(request["kind"]) <= 128:
        raise ValueError("a classification judgment request is required")
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
    if pattern.get("direction") not in ("inflow", "outflow"):
        raise ValueError("invalid direction")
    signals = pattern.get("signals")
    if not isinstance(signals, list) or len(signals) > 100 or any(not isinstance(s, str) or not 1 <= len(s) <= 128 for s in signals):
        raise ValueError("invalid signals")
    baseline_decision(request)
    samples = request.get("samples")
    if not isinstance(samples, list) or len(samples) > 3 or any(not isinstance(item, dict) for item in samples):
        raise ValueError("samples must contain at most three source observations")
    values = {
        "log_annualized": math.log10(values["annualizedEstimate"] + 1) / 5,
        "annualized_n": min(values["annualizedEstimate"] / 100000, 2),
        "median_n": min(values["typicalAmount"] / 5000, 2),
        "occurrences_n": min(count / 12, 1),
        "amount_cv": min(values["amountVariation"], 2),
        "gap_cv": min(values["intervalVariation"], 2),
        "cadence_days_n": values["cadenceDays"] / 365.25,
        "recency_n": min(values["recencyDays"] / 90, 1),
        "currency:" + pattern["currency"]: 1,
        "cadence:" + pattern["cadence"]: 1,
        "merchant:" + hashlib.sha256(pattern["merchant"].encode()).hexdigest(): 1,
    }
    # Interactions isolate classification-specific corrections without one model
    # per type. Feature storage stays bounded by hashing text into fixed buckets.
    prefix = request["kind"] + ":"
    values["direction:" + pattern["direction"]] = 1
    for signal in signals:
        values["signal:" + signal] = 1
    features = {}
    for key, value in values.items():
        bucket = int.from_bytes(hashlib.sha256((prefix + key).encode()).digest()[:4], "big") % 8192
        features[bucket] = features.get(bucket, 0) + value
    return features


def baseline_decision(request):
    question = request.get("question")
    if not isinstance(question, dict) or not isinstance(question.get("label"), str) or not 1 <= len(question["label"]) <= 128:
        raise ValueError("a classification question is required")
    for key in ("supportSignals", "candidateSignals", "excludeSignals"):
        signals = question.get(key)
        if signals is not None and (not isinstance(signals, list) or len(signals) > 100 or any(not isinstance(s, str) or not 1 <= len(s) <= 128 for s in signals)):
            raise ValueError(f"invalid {key}")
    if type(question.get("suggestWithoutSignal")) is not bool:
        raise ValueError("invalid suggestWithoutSignal")
    observed = set(request["pattern"].get("signals", []))
    if observed.intersection(question.get("excludeSignals") or []):
        return "unsupported"
    if observed.intersection(question.get("supportSignals") or []):
        return "supported"
    if question["suggestWithoutSignal"] or observed.intersection(question.get("candidateSignals") or []):
        return "uncertain"
    return "unsupported"
