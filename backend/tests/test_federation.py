import duckdb

from app.nodes.csv_dev import CsvHospitalNode
from app.pipeline.compiler import compile_aggregate
from app.pipeline.federation import merge_partials, run_nodes
from app.pipeline.smallcell import apply_small_cell
from app.pipeline.spec import Filter, GroupSpec, Metric, ObsValue, QuerySpec


def _populate(connection, rows: list[tuple[str, float]]) -> None:
    connection.execute(
        """
        CREATE TABLE patients (patient_id VARCHAR, sex VARCHAR, birth_date DATE, region VARCHAR, data_holder VARCHAR, opted_out BOOLEAN);
        CREATE TABLE conditions (patient_id VARCHAR, icd10 VARCHAR, description VARCHAR, onset_date DATE);
        CREATE TABLE medications (patient_id VARCHAR, atc VARCHAR, name VARCHAR, start_date DATE, end_date DATE);
        CREATE TABLE observations (patient_id VARCHAR, loinc VARCHAR, name VARCHAR, value DECIMAL(18,4), unit VARCHAR, date DATE);
        CREATE TABLE encounters (encounter_id VARCHAR, patient_id VARCHAR, data_holder VARCHAR, type VARCHAR, start_date DATE, end_date DATE, primary_icd10 VARCHAR);
        """
    )
    for patient_id, value in rows:
        connection.execute(
            "INSERT INTO patients VALUES (?, 'female', DATE '1980-01-01', 'Wien', 'Fixture', false)",
            [patient_id],
        )
        connection.execute(
            "INSERT INTO observations VALUES (?, '39156-5', 'BMI', ?, 'kg/m2', DATE '2025-01-01')",
            [patient_id, value],
        )


def _spec() -> QuerySpec:
    return QuerySpec(
        reference_date="2025-12-31",
        base=Filter(op="true"),
        groups=[GroupSpec(dimension="region")],
        metrics=[
            Metric(
                name="mean_bmi",
                type="mean",
                value=ObsValue(loinc="39156-5", pick="latest"),
                filter=Filter(op="true"),
            )
        ],
    )


def test_merged_mean_matches_the_unsplit_dataset():
    left = duckdb.connect()
    right = duckdb.connect()
    whole = duckdb.connect()
    _populate(left, [("a", 10), ("b", 20)])
    _populate(right, [("c", 30)])
    _populate(whole, [("a", 10), ("b", 20), ("c", 30)])
    # Keep every cell at or above the small-cell threshold by repeating the same values.
    for connection, pairs in (
        (left, [("a2", 10), ("b2", 20), ("a3", 10), ("b3", 20), ("a4", 10), ("b4", 20)]),
        (right, [("c2", 30), ("c3", 30), ("c4", 30)]),
        (whole, [("a2", 10), ("b2", 20), ("a3", 10), ("b3", 20), ("a4", 10), ("b4", 20), ("c2", 30), ("c3", 30), ("c4", 30)]),
    ):
        for patient_id, value in pairs:
            connection.execute(
                "INSERT INTO patients VALUES (?, 'female', DATE '1980-01-01', 'Wien', 'Fixture', false)",
                [patient_id],
            )
            connection.execute(
                "INSERT INTO observations VALUES (?, '39156-5', 'BMI', ?, 'kg/m2', DATE '2025-01-01')",
                [patient_id, value],
            )
    spec = _spec()
    compiled = compile_aggregate(spec)
    split_nodes = [CsvHospitalNode("Left", left), CsvHospitalNode("Right", right)]
    merged = merge_partials(run_nodes(split_nodes, compiled, 20), compiled)
    split_answer, _s, _f = apply_small_cell(spec, merged, ["Left", "Right"])
    whole_merged = merge_partials(run_nodes([CsvHospitalNode("Whole", whole)], compiled, 20), compiled)
    whole_answer, _s, _f = apply_small_cell(spec, whole_merged, ["Whole"])
    assert split_answer["Wien"] == whole_answer["Wien"]
    assert split_answer["Wien"] == 20.0
