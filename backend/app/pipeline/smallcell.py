"""Central small-cell rule. Runs after the merge and before anything is stored."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

COUNT_THRESHOLD = 10

REGIONS = [
    "Burgenland",
    "Kärnten",
    "Niederösterreich",
    "Oberösterreich",
    "Salzburg",
    "Steiermark",
    "Tirol",
    "Vorarlberg",
    "Wien",
]


def round_1(value: Decimal) -> float:
    """One decimal place, halves away from zero via ROUND_HALF_UP. Never uses round()."""
    quantized = value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return float(quantized)


def _decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


class MergedCell:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.sums: dict[str, Decimal] = {}
        self.ns: dict[str, int] = {}

    def add_count(self, name: str, value: int) -> None:
        self.counts[name] = self.counts.get(name, 0) + int(value)

    def add_mean(self, name: str, total: Any, n: int) -> None:
        self.sums[name] = self.sums.get(name, Decimal(0)) + _decimal(total or 0)
        self.ns[name] = self.ns.get(name, 0) + int(n or 0)


def group_domain(group, node_names: list[str]) -> list[str]:
    if group.dimension == "region":
        return list(REGIONS)
    if group.dimension == "sex":
        return ["female", "male"]
    if group.dimension == "data_holder":
        return list(node_names)
    if group.dimension == "age_band":
        return [band.label for band in (group.bands or [])]
    return []


def apply_small_cell(spec, merged: dict[tuple, MergedCell], node_names: list[str]) -> tuple[Any, list[dict], bool]:
    """Return the public answer, a suppression log without raw values, and whether anything was suppressed."""
    output_metrics = [metric for metric in spec.metrics if metric.output]
    domains = [group_domain(group, node_names) for group in spec.groups]
    keys = _all_keys(domains)
    suppressed: list[dict] = []
    public_rows: list[tuple[tuple, Any]] = []

    for key in keys:
        cell = merged.get(key, MergedCell())
        values: dict[str, Any] = {}
        for metric in output_metrics:
            shown, rule = _present(metric, spec, cell)
            values[metric.name] = shown
            if rule:
                suppressed.append({"group": list(key), "metric": metric.name, "rule": rule})
        if len(spec.groups) == 1 and len(output_metrics) == 1:
            packed: Any = values[output_metrics[0].name]
        elif not output_metrics:
            packed = {}
        else:
            packed = values
        public_rows.append((key, packed))

    answer = _shape(spec, public_rows, output_metrics)
    return answer, suppressed, bool(suppressed)


def _present(metric, spec, cell: MergedCell) -> tuple[Any, str | None]:
    if metric.type == "count":
        count = int(cell.counts.get(metric.name, 0))
        if count < COUNT_THRESHOLD:
            return "<10", "count_below_10"
        return count, None
    if metric.type == "percent":
        numerator = int(cell.counts.get(metric.numerator or "", 0))
        denominator = int(cell.counts.get(metric.denominator or "", 0))
        if numerator < COUNT_THRESHOLD or denominator < COUNT_THRESHOLD:
            return "suppressed", "percent_small_cell"
        value = (_decimal(numerator) / _decimal(denominator)) * Decimal(100)
        return round_1(value), None
    if metric.type == "mean":
        n = int(cell.ns.get(metric.name, 0))
        if n < COUNT_THRESHOLD:
            return "suppressed", "mean_small_cell"
        value = cell.sums.get(metric.name, Decimal(0)) / _decimal(n)
        return round_1(value), None
    return None, None


def _all_keys(domains: list[list[str]]) -> list[tuple]:
    if not domains:
        return [()]
    keys: list[tuple] = [()]
    for domain in domains:
        keys = [(*prefix, label) for prefix in keys for label in domain]
    return keys


def _shape(spec, rows: list[tuple[tuple, Any]], output_metrics: list) -> Any:
    if not spec.groups:
        if len(output_metrics) == 1:
            return {output_metrics[0].name: rows[0][1]} if rows else {}
        return rows[0][1] if rows else {}
    if len(spec.groups) == 1:
        return {key[0]: value for key, value in rows}
    shaped: dict = {}
    for key, value in rows:
        shaped.setdefault(key[0], {})[key[1]] = value
    return shaped
