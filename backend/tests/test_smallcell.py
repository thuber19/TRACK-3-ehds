from decimal import Decimal

from app.pipeline.smallcell import MergedCell, apply_small_cell, round_1
from app.pipeline.spec import AgeBand, Filter, GroupSpec, Metric, ObsValue, QuerySpec


def _count_spec() -> QuerySpec:
    return QuerySpec(
        groups=[GroupSpec(dimension="age_band", bands=[AgeBand(label="band", min=0, max=120)])],
        metrics=[Metric(name="n", type="count", filter=Filter(op="true"))],
    )


def _answer(spec: QuerySpec, cell: MergedCell):
    answer, _suppressed, _flag = apply_small_cell(spec, {("band",): cell}, [])
    return answer["band"]


def test_counts_below_10_are_masked_and_10_is_kept():
    spec = _count_spec()
    for raw in (0, 9):
        cell = MergedCell()
        cell.add_count("n", raw)
        assert _answer(spec, cell) == "<10"
    cell = MergedCell()
    cell.add_count("n", 10)
    assert _answer(spec, cell) == 10


def test_percent_with_numerator_9_is_suppressed():
    spec = QuerySpec(
        groups=[GroupSpec(dimension="age_band", bands=[AgeBand(label="band", min=0, max=120)])],
        metrics=[
            Metric(name="num", type="count", output=False),
            Metric(name="den", type="count", output=False),
            Metric(name="share_pct", type="percent", numerator="num", denominator="den"),
        ],
    )
    cell = MergedCell()
    cell.add_count("num", 9)
    cell.add_count("den", 100)
    assert _answer(spec, cell) == "suppressed"


def test_mean_with_n_9_is_suppressed():
    spec = QuerySpec(
        groups=[GroupSpec(dimension="age_band", bands=[AgeBand(label="band", min=0, max=120)])],
        metrics=[
            Metric(name="mean_bmi", type="mean", value=ObsValue(loinc="39156-5", pick="latest")),
        ],
    )
    cell = MergedCell()
    cell.add_mean("mean_bmi", Decimal("250"), 9)
    assert _answer(spec, cell) == "suppressed"


def test_halves_round_up_one_decimal():
    assert round_1(Decimal("0.25")) == 0.3
    assert round_1(Decimal("37.05")) == 37.1
    spec = QuerySpec(
        groups=[GroupSpec(dimension="age_band", bands=[AgeBand(label="band", min=0, max=120)])],
        metrics=[Metric(name="mean_bmi", type="mean", value=ObsValue(loinc="39156-5"))],
    )
    cell = MergedCell()
    cell.add_mean("mean_bmi", Decimal("2.5"), 10)
    assert _answer(spec, cell) == 0.3
