"""Run one compiled query on every hospital node and merge partial aggregates."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from app.pipeline.compiler import CompiledQuery
from app.pipeline.smallcell import MergedCell


class NodeFailure(Exception):
    def __init__(self, failures: list[tuple[str, str]]):
        self.failures = failures
        names = ", ".join(name for name, _message in failures)
        super().__init__(f"Hospital node failed: {names}")


@dataclass
class NodeRun:
    name: str
    rows: list[dict] | None
    duration_ms: int
    error: str | None = None


def execute(nodes: list, compiled: CompiledQuery, timeout_s: float, *, records: bool = False) -> list[NodeRun]:
    if not nodes:
        raise NodeFailure([("none", "No hospital nodes are configured")])
    runs: list[NodeRun] = []
    with ThreadPoolExecutor(max_workers=len(nodes)) as pool:
        future_map = {pool.submit(_call, node, compiled, records): node for node in nodes}
        for future in as_completed(future_map):
            node = future_map[future]
            try:
                rows, duration_ms = future.result(timeout=timeout_s)
                runs.append(NodeRun(name=node.name, rows=rows, duration_ms=duration_ms))
            except Exception as exc:  # noqa: BLE001 — one failed node fails the whole request
                runs.append(NodeRun(name=node.name, rows=None, duration_ms=0, error=f"{exc.__class__.__name__}: {exc}"))
    failures = [(run.name, run.error or "failed") for run in runs if run.error]
    if failures:
        error = NodeFailure(failures)
        error.runs = runs  # type: ignore[attr-defined]
        raise error
    return runs


def run_nodes(nodes: list, compiled: CompiledQuery, timeout_s: float) -> dict[str, list[dict]]:
    runs = execute(nodes, compiled, timeout_s)
    return {run.name: run.rows or [] for run in runs}


def _call(node, compiled: CompiledQuery, records: bool) -> tuple[list[dict], int]:
    started = time.perf_counter()
    if records:
        rows = node.fetch_records(compiled.sql, compiled.params)
    else:
        rows = node.run_aggregate(compiled.sql, compiled.params)
    return rows, int((time.perf_counter() - started) * 1000)


def merge_partials(per_node: dict[str, list[dict]], compiled: CompiledQuery) -> dict[tuple, MergedCell]:
    merged: dict[tuple, MergedCell] = {}
    for rows in per_node.values():
        for row in rows:
            key = tuple(row.get(f"g{index}") for index in range(compiled.group_count))
            cell = merged.setdefault(key, MergedCell())
            for index, name in enumerate(compiled.count_metrics):
                cell.add_count(name, int(row.get(f"c{index}") or 0))
            for index, name in enumerate(compiled.mean_metrics):
                cell.add_mean(name, row.get(f"s{index}") or 0, int(row.get(f"n{index}") or 0))
    return merged


def run_cohort(nodes: list, compiled: CompiledQuery, timeout_s: float) -> dict[str, list[str]]:
    """Exact patient ids per node. Callers must not put this list in an applicant response."""
    runs = execute(nodes, compiled, timeout_s, records=True)
    return {run.name: [row["patient_id"] for row in (run.rows or [])] for run in runs}
