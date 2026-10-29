"""Run one compiled query on DuckDB and Postgres when a hospital database is up."""

import os

import pytest

from app.nodes.csv_dev import load_csv_nodes
from app.nodes.postgres import PostgresHospitalNode
from app.pipeline.compiler import compile_aggregate
from tests.test_numbers import specs


def test_compiled_sql_runs_on_postgres_when_available():
    url = os.environ.get(
        "HOSPITAL_TEST_URL",
        "postgresql://hospital:hospital@localhost:5432/hospital?connect_timeout=2",
    )
    node = PostgresHospitalNode("Klinikum Nord", url)
    try:
        node.ping()
    except Exception as exc:  # noqa: BLE001 — the database is optional in CSV mode
        pytest.skip(f"Postgres not available: {exc.__class__.__name__}")
    compiled = compile_aggregate(specs()["R01"])
    csv_node = next(item for item in load_csv_nodes(node_root()) if item.name == "Klinikum Nord")
    postgres_rows = _normalise(node.run_aggregate(compiled.sql, compiled.params))
    duck_rows = _normalise(csv_node.run_aggregate(compiled.sql, compiled.params))
    assert postgres_rows == duck_rows


def node_root():
    from app.config import find_root

    return find_root() / "data"


def _normalise(rows: list[dict]) -> list[tuple]:
    normalised = []
    for row in rows:
        normalised.append(tuple(sorted((key, _value(value)) for key, value in row.items())))
    return sorted(normalised)


def _value(value):
    if hasattr(value, "quantize"):
        return float(value)
    if isinstance(value, float):
        return round(value, 4)
    return value
