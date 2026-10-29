import duckdb

from app.nodes.csv_dev import CsvHospitalNode
from app.pipeline.compiler import compile_aggregate, compile_cohort
from app.pipeline.federation import run_cohort, run_nodes
from app.pipeline.spe import create_spe
from app.pipeline.spec import Filter, GroupSpec, Metric, QuerySpec, SpeSpec


def _fixture() -> CsvHospitalNode:
    connection = duckdb.connect()
    connection.execute(
        """
        CREATE TABLE patients (patient_id VARCHAR, sex VARCHAR, birth_date DATE, region VARCHAR, data_holder VARCHAR, opted_out BOOLEAN);
        CREATE TABLE conditions (patient_id VARCHAR, icd10 VARCHAR, description VARCHAR, onset_date DATE);
        CREATE TABLE medications (patient_id VARCHAR, atc VARCHAR, name VARCHAR, start_date DATE, end_date DATE);
        CREATE TABLE observations (patient_id VARCHAR, loinc VARCHAR, name VARCHAR, value DECIMAL(18,4), unit VARCHAR, date DATE);
        CREATE TABLE encounters (encounter_id VARCHAR, patient_id VARCHAR, data_holder VARCHAR, type VARCHAR, start_date DATE, end_date DATE, primary_icd10 VARCHAR);
        INSERT INTO patients VALUES
          ('opted-out', 'female', DATE '1970-01-01', 'Wien', 'Fixture', true),
          ('kept', 'female', DATE '1970-01-01', 'Wien', 'Fixture', false);
        INSERT INTO conditions VALUES
          ('opted-out', 'E11.9', 'Type 2 diabetes', DATE '2020-01-01'),
          ('kept', 'E11.9', 'Type 2 diabetes', DATE '2020-01-01');
        INSERT INTO medications VALUES
          ('opted-out', 'A10BA02', 'Metformin', DATE '2024-01-01', NULL),
          ('kept', 'A10BA02', 'Metformin', DATE '2024-01-01', NULL);
        INSERT INTO observations VALUES
          ('opted-out', '4548-4', 'HbA1c', 8.1, '%', DATE '2025-01-01'),
          ('kept', '4548-4', 'HbA1c', 7.2, '%', DATE '2025-01-01');
        INSERT INTO encounters VALUES
          ('e1', 'opted-out', 'Fixture', 'inpatient', DATE '2025-02-01', DATE '2025-02-02', 'E11.9'),
          ('e2', 'kept', 'Fixture', 'inpatient', DATE '2025-03-01', DATE '2025-03-02', 'E11.9');
        """
    )
    return CsvHospitalNode("Fixture", connection)


def test_opted_out_patient_is_excluded_from_counts_and_spe(tmp_path):
    node = _fixture()
    spec = QuerySpec(
        reference_date="2025-12-31",
        base=Filter(
            op="and",
            filters=[
                Filter(op="age_gte", value=18),
                Filter(op="has_condition", icd10_prefixes=["E11"]),
                Filter(op="has_observation", loinc="4548-4"),
                Filter(op="has_active_medication", atc_prefixes=["A10BA"], on_date="2025-12-31"),
            ],
        ),
        groups=[GroupSpec(dimension="region")],
        metrics=[Metric(name="n", type="count", filter=Filter(op="true"))],
        spe=SpeSpec(record_types=["conditions", "medications", "observations"], observation_loinc=["4548-4"]),
    )
    compiled = compile_aggregate(spec)
    rows = run_nodes([node], compiled, 20)["Fixture"]
    assert sum(int(row["c0"]) for row in rows) == 1

    cohort = run_cohort([node], compile_cohort(spec), 20)
    assert cohort["Fixture"] == ["kept"]
    created = create_spe("optout", [node], cohort, spec, tmp_path)
    assert created["cohort_size"] == 1
    check = duckdb.connect(str(tmp_path / "optout.duckdb"), read_only=True)
    ids = {row[0] for row in check.execute("SELECT patient_id FROM cohort").fetchall()}
    condition_ids = {row[0] for row in check.execute("SELECT patient_id FROM conditions").fetchall()}
    assert ids == {"kept"}
    assert "opted-out" not in condition_ids
    assert "opted-out" not in {row[0] for row in check.execute("SELECT patient_id FROM observations").fetchall()}
    check.close()
