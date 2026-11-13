#!/usr/bin/env python3
"""Real-dataset evaluation harness for the payment-pattern pipeline.

Proves the pipeline on public data: downloads a labeled bank-descriptor
dataset, normalizes rows through the existing Go backend (grouping,
recurrence, signals, classifications), scores deterministic output against
dataset labels, trains the River learner (PaymentModelStore.state/evaluate/
observe only) to measure lift, runs experiment arms that isolate drift
diagnosis, and measures per-event train/eval latency plus peak RSS to
substantiate the online-learner volume claim.

Reads and writes only; never modifies model.py or server.py.
Run with the repo toolchain from the ml directory, e.g.::

    cd ml && uv run --with pyarrow --with pandas eval/harness.py --slice 5000

Layout: fixture JSON and findings JSON live under ml/eval/.cache/ (gitignored);
the learner uses a throwaway ML_MODEL_PATH under /tmp. Nothing is vendored
into the repo.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
ML_DIR = EVAL_DIR.parent
REPO_ROOT = ML_DIR.parent
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(EVAL_DIR))

from datasets import (
    BASE_DATE,
    CATEGORY_KINDS,
    MAPPED_KINDS,
    MONEYDATASET_ID,
    PARQUET_URL,
    SEED,
    build_aliases,
    download_parquet,
    load_mitul,
    load_moneydata,
    load_rows,
    sample_rows,
)
from events import category_requests_by_id, findings_by_request, run_go_harness
from scoring import alias_hit_rate, score_arm, score_category_arm, signal_support_share
from training import (
    expected_by_request,
    order_requests,
    run_arm,
    run_seed_recipe,
    run_shift_probe,
)

CACHE_DIR = EVAL_DIR / ".cache"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Real-dataset eval harness")
    parser.add_argument("--slice", type=int, default=5000,
                        help="rows to sample (stratified, fixed seed)")
    parser.add_argument("--full", action="store_true",
                        help="use all 68k rows instead of --slice")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--months", type=int, default=6)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--export-seed", type=Path, default=None,
                        help="export a seed learner DB to this path (outside the repo)")
    parser.add_argument("--seed-probe", type=Path, default=None,
                        help="write the seed verification probe set here")
    parser.add_argument("--source", choices=("hf-v2", "moneydata", "mitul", "all"),
                        default="hf-v2",
                        help="dataset source (default: hf-v2)")
    parser.add_argument("--moneydata-path", type=Path, default=None,
                        help="Laramee MoneyData xlsx (required for moneydata/all)")
    parser.add_argument("--mitul-path", type=Path, default=None,
                        help="mitul transaction-categorization parquet (required for mitul/all)")
    return parser.parse_args()


def run_source(args, cache: Path, tag: str, rows: list[dict],
               source_label: str, source_license: str) -> tuple[dict, list, list]:
    """One full eval pass for a dataset; returns (report, seed_ordered, cat_seed_ordered).

    seed_ordered is the interleaved payment baseline (request, action) list
    and cat_seed_ordered the interleaved category (request, action) list for
    the combined seed phase. Report filenames are suffixed per source so a
    combined run never clobbers single-source outputs.
    """
    suffix = "" if tag == "hf-v2" else f"-{tag}"
    label_counts = Counter(r["category"] for r in rows)
    # The mitul arm is descriptor breadth only: one representative occurrence
    # per row, no payment-series synthesis.
    months = 1 if tag == "mitul" else args.months
    if args.full or tag == "mitul":
        sampled = list(rows)
    else:
        sampled = sample_rows(rows, args.slice, args.seed)
    aliases = build_aliases(sampled)

    fixture_path = cache / f"fixture{suffix}.json"
    with open(fixture_path, "w") as handle:
        json.dump(
            {
                "meta": {
                    "source": source_label,
                    "rows": len(sampled),
                    "seed": args.seed,
                    "months": months,
                    "baseDate": BASE_DATE,
                },
                "aliases": aliases,
                "rows": sampled,
            },
            handle,
        )
    findings_path = cache / f"findings{suffix}.json"
    output = run_go_harness(fixture_path, findings_path, months, args.seed)
    transactions = output["transactions"]

    arms_output = {}
    for arm in ("baseline", "providers"):
        arms_output[arm] = score_arm(transactions, output["findings"][arm])
    support = {
        arm: signal_support_share(findings_by_request(output["findings"][arm]))
        for arm in ("baseline", "providers")
    }
    alias_hits = alias_hit_rate(output)

    expected_by_stem = {
        t["id"][: len("eval-000000")]: t["expectedKind"] for t in transactions
    }
    learner_arms = {}
    arm_specs = [
        ("desc-interleaved", "baseline", "interleaved"),
        ("desc-sequential", "baseline", "sequential"),
        ("prov-interleaved", "providers", "interleaved"),
        ("prov-sequential", "providers", "sequential"),
    ]
    for name, findings_arm, order in arm_specs:
        requests = findings_by_request(output["findings"][findings_arm])
        ordered = order_requests(
            requests, expected_by_request(requests, expected_by_stem), order
        )
        learner_arms[name] = run_arm(f"{tag}-{name}", requests, ordered)
    probe_ordered = order_requests(
        findings_by_request(output["findings"]["baseline"]),
        expected_by_request(
            findings_by_request(output["findings"]["baseline"]),
            expected_by_stem,
        ),
        "interleaved",
    )
    probe = run_shift_probe(probe_ordered)

    seed_ordered = order_requests(
        findings_by_request(output["findings"]["baseline"]),
        expected_by_request(
            findings_by_request(output["findings"]["baseline"]),
            expected_by_stem,
        ),
        "interleaved",
    )

    cat_entries = output["findings"].get("categoryRequests", [])
    cat_scored = score_category_arm(transactions, cat_entries)
    cat_requests = category_requests_by_id(cat_entries)
    cat_expected_by_request = {
        request_id: (f"category:{item['expected']}" if item["expected"] else "")
        for request_id, item in cat_requests.items()
    }
    cat_learner_arms = {}
    for name, order in (("cat-interleaved", "interleaved"),
                        ("cat-sequential", "sequential")):
        cat_ordered = order_requests(cat_requests, cat_expected_by_request, order)
        cat_learner_arms[name] = run_arm(f"{tag}-{name}", cat_requests, cat_ordered)
    cat_seed_ordered = order_requests(
        cat_requests, cat_expected_by_request, "interleaved"
    )
    report = {
        "dataset": {
            "source": source_label,
            "license": source_license,
            "total_rows": len(rows),
            "label_counts": dict(sorted(label_counts.items())),
            "sampled_rows": len(sampled),
            "full": bool(args.full),
            "seed": args.seed,
            "months": months,
            "base_date": BASE_DATE,
        },
        "go_seconds": output["_go_seconds"],
        "go_transactions": output["meta"]["transactions"],
        "alias_table_size": len(aliases),
        "alias_hit_rate": alias_hits,
        "deterministic": arms_output,
        "category_deterministic": cat_scored,
        "signal_support": support,
        "learner": learner_arms,
        "category_learner": cat_learner_arms,
        "shift_probe": probe,
        "seed": None,
    }
    report_path = args.report or (cache / f"report{suffix}.json")
    with open(report_path, "w") as handle:
        json.dump(report, handle, indent=2)
    print(f"### source: {tag}")
    print_summary(report)
    return report, seed_ordered, cat_seed_ordered


def main() -> None:
    args = parse_args()
    cache = args.cache_dir
    cache.mkdir(parents=True, exist_ok=True)

    tags = ("hf-v2", "moneydata", "mitul") if args.source == "all" else (args.source,)
    seed_inputs: list[tuple[str, list]] = []
    cat_seed_inputs: list[tuple[str, list]] = []
    for tag in tags:
        if tag == "hf-v2":
            parquet_path = download_parquet(cache, PARQUET_URL)
            rows = load_rows(parquet_path)
            source_label = "DoDataThings/us-bank-transaction-categories-v2"
            source_license = "MIT"
        elif tag == "mitul":
            if args.mitul_path is None:
                raise SystemExit("--mitul-path is required for mitul/all (gated download, never vendored)")
            rows = load_mitul(args.mitul_path, seed=args.seed)
            source_label = "mitulshah/transaction-categorization"
            source_license = "gated (local copy; see README)"
        else:
            if args.moneydata_path is None:
                raise SystemExit("--moneydata-path is required for moneydata")
            rows = load_moneydata(args.moneydata_path)
            source_label = MONEYDATASET_ID
            source_license = "CC BY 4.0 (citation required, see README)"
        _, seed_ordered, cat_seed_ordered = run_source(args, cache, tag, rows,
                                     source_label, source_license)
        # The mitul arm runs a single representative occurrence per row, so
        # its payment findings carry no recurrence signal and stay out of
        # the seed; only its category order trains.
        if tag != "mitul":
            seed_inputs.append((tag, seed_ordered))
        cat_seed_inputs.append((tag, cat_seed_ordered))

    if args.export_seed is not None:
        probe_path = args.seed_probe or (cache / "seed-probe.json")
        seed = run_seed_recipe(seed_inputs, args.export_seed, probe_path,
                               cat_ordered_lists=cat_seed_inputs)
        print("### combined seed")
        print(json.dumps(
            {"events": seed["events"],
             "payment_events": seed["payment_events"],
             "category_events": seed["category_events"],
             "coverage_counts": seed["coverage_counts"],
             "category_coverage_counts": seed["category_coverage_counts"],
             "verification": seed["verification"],
             "drift_at_export": seed["drift_at_export"]}, indent=2))


def print_learner_arm(name: str, arm: dict) -> None:
    print(
        f"  {name:18s} events={arm['events']} "
        f"pre={arm['pre']['accuracy']:.4f} post={arm['post']['accuracy']:.4f} "
        f"lift={arm['lift']:+.4f} trips={arm['trips']} warnings={arm['warnings']} "
        f"train_ms/event med={arm['train_per_event_ms']['median']:.3f} "
        f"p90={arm['train_per_event_ms']['p90']:.3f} "
        f"eval_ms/event med={arm['eval_per_event_ms']['median']:.3f} "
        f"peak_rss_mb={arm['peak_rss_mb']:.1f}"
    )
    print(
        f"    pre_decisions={arm['pre']['decision_counts']} "
        f"decisive={arm['pre']['decisive_rate']:.3f} | "
        f"post_decisions={arm['post']['decision_counts']} "
        f"decisive={arm['post']['decisive_rate']:.3f}"
    )
    print(
        f"    trajectory(batch:probe_acc/decisive/detections): "
        + " ".join(
            f"{t['batch']}:{t['probe_accuracy']:.3f}/{t['decisive_rate']:.3f}/{t['detections']}"
            for t in arm.get("trajectory", [])
        )
    )


def print_summary(report: dict) -> None:
    print("# Real-dataset eval report\n")
    ds = report["dataset"]
    print(
        f"Dataset {ds['source']} ({ds['license']}): "
        f"{ds['sampled_rows']}/{ds['total_rows']} rows, "
        f"{ds['months']} synthetic months each, "
        f"Go stage {report['go_seconds']:.1f}s for {report['go_transactions']} transactions."
    )
    print(
        f"Alias table: {report['alias_table_size']} entries, "
        f"provider-signal hit rate {report['alias_hit_rate']['hit_rate']:.3f} "
        f"({report['alias_hit_rate']['with_new_provider_signal']}/"
        f"{report['alias_hit_rate']['findings']} alias-covered findings; "
        f"per-kind {report['alias_hit_rate']['per_kind']})."
    )
    for arm, scored in report["deterministic"].items():
        print(f"\n## Deterministic arm: {arm}")
        print(
            f"transactions={scored['transactions']} findings={scored['findings']} "
            f"overall_accuracy={scored['accuracy']:.4f} "
            f"expected-none clean {scored['none_clean']}/{scored['none_expected']} "
            f"({scored['none_clean_rate']:.4f})"
        )
        for kind in MAPPED_KINDS:
            m = scored["per_kind"][kind]
            print(
                f"  {kind:15s} P={m['precision']:.4f} R={m['recall']:.4f} "
                f"F1={m['f1']:.4f} (tp={m['tp']} fp={m['fp']} fn={m['fn']})"
            )
        print("  confusion rows expected -> predicted " + "/".join(MAPPED_KINDS + ["none"]))
        for exp in MAPPED_KINDS + ["none"]:
            cells = " ".join(
                f"{p}={scored['confusion'][exp][p]}" for p in MAPPED_KINDS + ["none"]
            )
            print(f"    {exp:15s} {cells}")
    print("\n## Signal support (backed vs hint-only requests)")
    for arm, kinds in report["signal_support"].items():
        for kind, share in kinds.items():
            print(
                f"  {arm}/{kind}: requests={share['requests']} "
                f"backed={share['with_descriptor_signal']} "
                f"hint-only={share['source_only']}"
            )
    print("\n## Strength split (strong = detector-supported, moderate = candidate)")
    for arm, scored in report["deterministic"].items():
        cells = " ".join(
            f"{e}={scored['strength'][e]['strong']}s/{scored['strength'][e]['moderate']}m"
            for e in MAPPED_KINDS + ["none"]
        )
        print(f"  {arm}: {cells}")
    scored = report["category_deterministic"]
    print("\n## Deterministic category arm (cold-start keyword policy)")
    print(
        f"transactions={scored['transactions']} entries={scored['entries']} "
        f"overall_accuracy={scored['accuracy']:.4f} "
        f"expected-none clean {scored['none_clean']}/{scored['none_expected']} "
        f"({scored['none_clean_rate']:.4f})"
    )
    for kind in CATEGORY_KINDS:
        m = scored["per_kind"][kind]
        print(
            f"  {kind:22s} P={m['precision']:.4f} R={m['recall']:.4f} "
            f"F1={m['f1']:.4f} (tp={m['tp']} fp={m['fp']} fn={m['fn']})"
        )
    print("  confusion rows expected -> predicted " + "/".join(CATEGORY_KINDS + ["none"]))
    for exp in CATEGORY_KINDS + ["none"]:
        cells = " ".join(
            f"{p}={scored['confusion'][exp][p]}" for p in CATEGORY_KINDS + ["none"]
        )
        print(f"    {exp:22s} {cells}")
    print("\n## Learner arms (fresh store each; strict accuracy, uncertain counts as wrong)")
    for name, arm in report["learner"].items():
        print_learner_arm(name, arm)
    print("\n## Category learner arms (confirm expected kind, reject other emitted kinds)")
    for name, arm in report["category_learner"].items():
        print_learner_arm(name, arm)
    probe = report["shift_probe"]
    if "skipped" in probe:
        print(f"\n## Synthetic shift probe skipped: {probe['skipped']}")
        return
    print(
        "\n## Synthetic shift probe (labels flipped after convergence; not dataset evidence)"
    )
    print(
        f"  agree={probe['agree_events']} flip={probe['flip_events']} "
        f"probe={probe['probe_requests']} "
        f"acc_before={probe['accuracy_before_flip']:.4f} "
        f"acc_after={probe['accuracy_after_flip']:.4f} "
        f"delta={probe['accuracy_delta']:+.4f} "
        f"detections={probe['detections_during_flip']} "
        f"warnings={probe['warnings_during_flip']}"
    )
    seed = report.get("seed")
    if seed:
        print("\n## Seed export (canonical recipe: baseline findings, interleaved)")
        print(f"  path={seed['export']['path']} "
              f"revision={seed['export']['revision']} "
              f"examples={seed['export']['examples_seen']} "
              f"counts={seed['export']['classification_counts']}")
        print(f"  probe={seed['probe_requests']} "
              f"verify_identical={seed['verification']['identical']} "
              f"matched={seed['verification']['matched']}/{seed['verification']['probe_requests']} "
              f"drift_at_export={seed['drift_at_export']}")


if __name__ == "__main__":
    main()
