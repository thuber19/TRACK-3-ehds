"""Hand-written QuerySpecs for the approved statistical requests. The pipeline itself does not use these."""

import json

from app.config import find_root
from app.pipeline.compiler import compile_aggregate, compile_cohort
from app.pipeline.federation import merge_partials, run_cohort, run_nodes
from app.pipeline.smallcell import apply_small_cell
from app.pipeline.spec import AgeBand, Filter, GroupSpec, Metric, ObsValue, QuerySpec

ROOT = find_root()
EXPECTED = json.loads((ROOT / "requests" / "expected.json").read_text(encoding="utf-8"))


def _bands(*labels: str) -> list[AgeBand]:
    bands = []
    for label in labels:
        if label.endswith("+"):
            bands.append(AgeBand(label=label, min=int(label[:-1]), max=None))
        else:
            low, high = label.split("-")
            bands.append(AgeBand(label=label, min=int(low), max=int(high)))
    return bands


def specs() -> dict[str, QuerySpec]:
    return {
        "R01": QuerySpec(
            base=Filter(op="age_gte", value=18),
            groups=[GroupSpec(dimension="region")],
            metrics=[
                Metric(name="adults", type="count", filter=Filter(op="true")),
                Metric(name="type2_diabetes", type="count", filter=Filter(op="has_condition", icd10_prefixes=["E11"])),
                Metric(name="prevalence_pct", type="percent", numerator="type2_diabetes", denominator="adults"),
            ],
        ),
        "R03": QuerySpec(
            base=Filter(
                op="and",
                filters=[
                    Filter(op="age_gte", value=65),
                    Filter(op="has_condition", icd10_prefixes=["I48"]),
                ],
            ),
            groups=[GroupSpec(dimension="age_band", bands=_bands("65-74", "75-84", "85+"))],
            metrics=[
                Metric(name="af_patients", type="count", filter=Filter(op="true")),
                Metric(
                    name="without_oac",
                    type="count",
                    filter=Filter(
                        op="not",
                        filter=Filter(op="has_active_medication", atc_prefixes=["B01AA", "B01AF"], on_date="2025-12-31"),
                    ),
                ),
                Metric(name="share_without_oac_pct", type="percent", numerator="without_oac", denominator="af_patients"),
            ],
        ),
        "R07": QuerySpec(
            unit="encounter",
            base=Filter(
                op="and",
                filters=[
                    Filter(op="encounter_type", value="inpatient"),
                    Filter(op="encounter_start_between", start="2025-01-01", end="2025-12-31"),
                ],
            ),
            groups=[GroupSpec(dimension="region")],
            metrics=[Metric(name="inpatient_stays", type="count", filter=Filter(op="true"))],
        ),
        "R08": QuerySpec(
            base=Filter(
                op="and",
                filters=[
                    Filter(op="sex", value="female"),
                    Filter(op="has_condition", icd10_prefixes=["C50"]),
                ],
            ),
            groups=[GroupSpec(dimension="region")],
            metrics=[
                Metric(name="women_with_bmi", type="count", filter=Filter(op="has_observation", loinc="39156-5")),
                Metric(
                    name="mean_bmi",
                    type="mean",
                    value=ObsValue(loinc="39156-5", pick="latest"),
                    filter=Filter(op="has_observation", loinc="39156-5"),
                ),
            ],
        ),
        "R09": QuerySpec(
            base=Filter(
                op="and",
                filters=[
                    Filter(op="age_gte", value=18),
                    Filter(op="has_condition", icd10_prefixes=["I10"]),
                ],
            ),
            groups=[GroupSpec(dimension="age_band", bands=_bands("18-49", "50-64", "65+"))],
            metrics=[
                Metric(name="adults_with_hypertension", type="count", filter=Filter(op="true")),
                Metric(
                    name="ace_n",
                    type="count",
                    output=False,
                    filter=Filter(op="has_active_medication", atc_prefixes=["C09AA"], on_date="2025-12-31"),
                ),
                Metric(
                    name="arb_n",
                    type="count",
                    output=False,
                    filter=Filter(op="has_active_medication", atc_prefixes=["C09CA"], on_date="2025-12-31"),
                ),
                Metric(name="ace_inhibitor_pct", type="percent", numerator="ace_n", denominator="adults_with_hypertension"),
                Metric(name="arb_pct", type="percent", numerator="arb_n", denominator="adults_with_hypertension"),
            ],
        ),
    }


def test_handwritten_specs_match_expected(nodes):
    for name, spec in specs().items():
        compiled = compile_aggregate(spec)
        merged = merge_partials(run_nodes(nodes, compiled, 20), compiled)
        answer, _suppressed, _flag = apply_small_cell(spec, merged, [node.name for node in nodes])
        assert answer == EXPECTED[name]["answer"]


def test_r05_cohort_size(nodes):
    spec = QuerySpec(
        base=Filter(
            op="and",
            filters=[
                Filter(op="age_gte", value=18),
                Filter(op="has_condition", icd10_prefixes=["E11"]),
                Filter(op="has_observation", loinc="4548-4"),
            ],
        )
    )
    cohort = run_cohort(nodes, compile_cohort(spec), 20)
    assert len({patient_id for ids in cohort.values() for patient_id in ids}) == EXPECTED["R05"]["answer"]["cohort_size"]
