#!/usr/bin/env python3
"""Submit the ten example requests three times and write metrics.md."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
REQUESTS = ROOT / "requests"
BASE = os.environ.get("HDAB_URL", "http://127.0.0.1:8000").rstrip("/")
RUNS = 3


def main() -> None:
    expected = json.loads((REQUESTS / "expected.json").read_text(encoding="utf-8"))
    names = [f"R{index:02d}" for index in range(1, 11)]
    payloads = {name: json.loads((REQUESTS / f"{name}.json").read_text(encoding="utf-8")) for name in names}
    results: dict[str, list[dict]] = {name: [] for name in names}
    timings: dict[str, list[float]] = {name: [] for name in names}

    with httpx.Client(base_url=BASE, timeout=120) as client:
        login = client.post("/api/auth/login", json={"username": "applicant", "password": "applicant"})
        login.raise_for_status()
        for _run in range(RUNS):
            for name in names:
                started = time.perf_counter()
                response = client.post("/api/requests", json=payloads[name])
                elapsed = time.perf_counter() - started
                response.raise_for_status()
                body = response.json()
                results[name].append(body)
                timings[name].append(elapsed)

    decision_hits = 0
    number_hits = 0
    leaks = 0
    consistent = 0
    diffs: list[str] = []
    approved = [name for name, item in expected.items() if item["answer"] is not None]

    for name in names:
        runs = results[name]
        target = expected[name]
        decisions_ok = all(run["decision"] == target["decision"] and _articles_ok(run["articles"], target["articles"]) for run in runs)
        if decisions_ok:
            decision_hits += 1
        else:
            diffs.append(f"{name} decision: got {runs[0]['decision']} {runs[0]['articles']}, expected {target['decision']} {target['articles']}")
        if target["answer"] is not None:
            numbers_ok = all(_answer_ok(target["answer"], run["answer"]) for run in runs)
            if numbers_ok:
                number_hits += 1
            else:
                diffs.append(f"{name} numbers:\n  expected {json.dumps(target['answer'], ensure_ascii=False)}\n  got      {json.dumps(runs[0]['answer'], ensure_ascii=False)}")
        signatures = [_signature(run) for run in runs]
        if len(set(signatures)) == 1:
            consistent += 1
        else:
            diffs.append(f"{name} was not identical across {RUNS} runs")
        for run in runs:
            leaks += _leaks(run["answer"], target["answer"], run["decision"])

    slowest = max(max(values) for values in timings.values())
    lines = [
        "# Metrics",
        "",
        "| Metric | Result | Target |",
        "|---|---|---|",
        f"| Correct decisions | {decision_hits}/10 | 10/10 |",
        f"| Correct numbers | {number_hits}/{len(approved)} | {len(approved)}/{len(approved)} |",
        f"| Privacy leaks | {leaks} | 0 |",
        f"| Consistency | {consistent}/10 | 10/10 |",
        f"| Time to answer | {slowest:.2f} s | < 60 s |",
        "",
        "Time to answer is the slowest submission among the ten requests, measured from POST to response, across three runs.",
        "",
    ]
    if diffs:
        lines.append("## Differences")
        lines.append("")
        for diff in diffs:
            lines.append(f"- {diff}")
        lines.append("")
    (ROOT / "metrics.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    if diffs:
        raise SystemExit(1)


def _articles_ok(actual: list[str], expected: list[str]) -> bool:
    extra = set(actual) - set(expected)
    return set(expected).issubset(set(actual)) and extra.issubset({"67", "71"})


def _answer_ok(expected, actual) -> bool:
    if expected is None:
        return actual is None
    if not isinstance(expected, dict):
        return _same(expected, actual)
    if not isinstance(actual, dict):
        return False
    for key, value in expected.items():
        if key not in actual:
            return False
        if isinstance(value, dict):
            if not _answer_ok(value, actual[key]):
                return False
        elif not _same(value, actual[key]) and not _value_somewhere(value, actual[key]):
            return False
    return True


def _value_somewhere(expected, actual) -> bool:
    if isinstance(actual, dict):
        return any(_same(expected, item) or _value_somewhere(expected, item) for item in actual.values())
    return _same(expected, actual)


def _same(left, right) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)) and not isinstance(left, bool):
        return abs(float(left) - float(right)) < 1e-9
    return left == right


def _signature(run: dict) -> str:
    return json.dumps(
        {"decision": run["decision"], "articles": run["articles"], "answer": run["answer"]},
        sort_keys=True,
        ensure_ascii=False,
    )


def _leaks(answer, expected, decision: str) -> int:
    if answer is None:
        return 0
    count = 0
    if _contains_patient_material(answer):
        count += 1
    if decision == "APPROVE_STATISTICAL":
        count += _small_counts(answer)
        count += _missed_suppressions(expected, answer)
    return count


def _contains_patient_material(value) -> bool:
    if isinstance(value, dict):
        if "patient_id" in value or "birth_date" in value:
            return True
        return any(_contains_patient_material(item) for item in value.values())
    if isinstance(value, list):
        if any(isinstance(item, dict) for item in value):
            return True
        return any(_contains_patient_material(item) for item in value)
    if isinstance(value, str) and value.startswith("p-") and len(value) > 8:
        return True
    return False


def _small_counts(value, key=None) -> int:
    found = 0
    if isinstance(value, dict):
        for child_key, child in value.items():
            found += _small_counts(child, child_key)
        return found
    if isinstance(value, list):
        return sum(_small_counts(item, key) for item in value)
    if isinstance(value, bool):
        return 0
    if isinstance(value, int) and key != "cohort_size" and value < 10:
        return 1
    return 0


def _missed_suppressions(expected, actual) -> int:
    if isinstance(expected, dict) and isinstance(actual, dict):
        found = 0
        for key, value in expected.items():
            if key in actual:
                found += _missed_suppressions(value, actual[key])
        return found
    if expected in {"<10", "suppressed"} and isinstance(actual, (int, float)) and not isinstance(actual, bool):
        return 1
    return 0


if __name__ == "__main__":
    main()
