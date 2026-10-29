from datetime import date

import duckdb

from app.nodes.csv_dev import CsvHospitalNode
from app.pipeline.compiler import compile_aggregate
from app.pipeline.spec import Filter, GroupSpec, Metric, ObsValue, QuerySpec


def _node(sql: str, name: str = "Fixture") -> CsvHospitalNode:
    connection = duckdb.connect()
    connection.execute(sql)
    return CsvHospitalNode(name, connection)


def _base_tables() -> str:
    return """
    CREATE TABLE patients (patient_id VARCHAR, sex VARCHAR, birth_date DATE, region VARCHAR, data_holder VARCHAR, opted_out BOOLEAN);
    CREATE TABLE conditions (patient_id VARCHAR, icd10 VARCHAR, description VARCHAR, onset_date DATE);
    CREATE TABLE medications (patient_id VARCHAR, atc VARCHAR, name VARCHAR, start_date DATE, end_date DATE);
    CREATE TABLE observations (patient_id VARCHAR, loinc VARCHAR, name VARCHAR, value DECIMAL(18,4), unit VARCHAR, date DATE);
    CREATE TABLE encounters (encounter_id VARCHAR, patient_id VARCHAR, data_holder VARCHAR, type VARCHAR, start_date DATE, end_date DATE, primary_icd10 VARCHAR);
    """


def _count(node, spec) -> int:
    compiled = compile_aggregate(spec)
    assert "opted_out = false" in compiled.sql
    assert "eligible AS" in compiled.sql
    assert "round(" not in compiled.sql.lower()
    rows = node.run_aggregate(compiled.sql, compiled.params)
    return sum(int(row["c0"]) for row in rows)


def test_age_on_the_reference_date_and_the_day_after():
    node = _node(
        _base_tables()
        + """
        INSERT INTO patients VALUES
          ('born-on-ref', 'female', DATE '2025-12-31', 'Wien', 'Fixture', false),
          ('born-next-day', 'female', DATE '2026-01-01', 'Wien', 'Fixture', false),
          ('turns-18', 'female', DATE '2007-12-31', 'Wien', 'Fixture', false),
          ('still-17', 'male', DATE '2008-01-01', 'Wien', 'Fixture', false);
        """
    )
    adults = QuerySpec(
        reference_date="2025-12-31",
        base=Filter(op="age_gte", value=18),
        groups=[GroupSpec(dimension="region")],
        metrics=[Metric(name="n", type="count", filter=Filter(op="true"))],
    )
    # Only the person born on 2007-12-31 has reached 18. A birth on the reference date is age 0.
    assert _count(node, adults) == 1
    newborn = QuerySpec(
        reference_date="2025-12-31",
        base=Filter(op="age_gte", value=0),
        groups=[GroupSpec(dimension="sex")],
        metrics=[Metric(name="n", type="count", filter=Filter(op="true"))],
    )
    compiled = compile_aggregate(newborn)
    rows = node.run_aggregate(compiled.sql, compiled.params)
    counted = sum(int(row["c0"]) for row in rows)
    # Birthday on the reference date counts; birthday on 2026-01-01 has not happened.
    assert counted == 3


def test_active_medication_includes_both_boundary_dates():
    node = _node(
        _base_tables()
        + """
        INSERT INTO patients VALUES
          ('starts-today', 'female', DATE '1980-01-01', 'Wien', 'Fixture', false),
          ('ends-today', 'female', DATE '1980-01-01', 'Wien', 'Fixture', false),
          ('starts-tomorrow', 'female', DATE '1980-01-01', 'Wien', 'Fixture', false),
          ('ended-yesterday', 'female', DATE '1980-01-01', 'Wien', 'Fixture', false),
          ('still-open', 'female', DATE '1980-01-01', 'Wien', 'Fixture', false);
        INSERT INTO medications VALUES
          ('starts-today', 'B01AF01', 'Rivaroxaban', DATE '2025-12-31', NULL),
          ('ends-today', 'B01AF01', 'Rivaroxaban', DATE '2020-01-01', DATE '2025-12-31'),
          ('starts-tomorrow', 'B01AF01', 'Rivaroxaban', DATE '2026-01-01', NULL),
          ('ended-yesterday', 'B01AF01', 'Rivaroxaban', DATE '2020-01-01', DATE '2025-12-30'),
          ('still-open', 'B01AF02', 'Apixaban', DATE '2024-01-01', NULL);
        """
    )
    spec = QuerySpec(
        reference_date="2025-12-31",
        base=Filter(op="true"),
        groups=[GroupSpec(dimension="region")],
        metrics=[
            Metric(
                name="n",
                type="count",
                filter=Filter(op="has_active_medication", atc_prefixes=["B01AF"], on_date="2025-12-31"),
            )
        ],
    )
    assert _count(node, spec) == 3


def test_latest_observation_is_the_newest_date():
    node = _node(
        _base_tables()
        + """
        INSERT INTO patients VALUES
          ('p1', 'female', DATE '1980-01-01', 'Wien', 'Fixture', false),
          ('p2', 'female', DATE '1980-06-01', 'Wien', 'Fixture', false);
        INSERT INTO observations VALUES
          ('p1', '39156-5', 'BMI', 10, 'kg/m2', DATE '2024-01-01'),
          ('p1', '39156-5', 'BMI', 20, 'kg/m2', DATE '2025-06-01'),
          ('p2', '39156-5', 'BMI', 30, 'kg/m2', DATE '2024-05-01');
        """
    )
    # Pad with eight more patients so the mean is not suppressed, then check the two known values
    # by reading the unsuppressed sum from a single-group query with n >= 10.
    for index in range(3, 11):
        node._con.execute(
            "INSERT INTO patients VALUES (?, 'female', DATE '1980-01-01', 'Wien', 'Fixture', false)",
            [f"pad{index}"],
        )
        node._con.execute(
            "INSERT INTO observations VALUES (?, '39156-5', 'BMI', 20, 'kg/m2', DATE '2025-01-01')",
            [f"pad{index}"],
        )
    spec = QuerySpec(
        reference_date="2025-12-31",
        base=Filter(op="true"),
        groups=[GroupSpec(dimension="region")],
        metrics=[
            Metric(name="n", type="count", filter=Filter(op="has_observation", loinc="39156-5")),
            Metric(
                name="mean_bmi",
                type="mean",
                value=ObsValue(loinc="39156-5", pick="latest"),
                filter=Filter(op="has_observation", loinc="39156-5"),
            ),
        ],
    )
    compiled = compile_aggregate(spec)
    rows = node.run_aggregate(compiled.sql, compiled.params)
    assert len(rows) == 1
    # p1 contributes 20 (not 10), p2 contributes 30, eight pads contribute 20.
    assert int(rows[0]["n0"]) == 10
    assert round(float(rows[0]["s0"]), 4) == 210
