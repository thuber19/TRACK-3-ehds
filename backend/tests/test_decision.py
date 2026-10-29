from app.pipeline.decision import PurposeAssessment, decide
from app.pipeline.spec import DataRequestIn


def _assessment(**overrides) -> PurposeAssessment:
    fields = dict(
        prohibited=False,
        prohibited_category=None,
        allowed_purposes=["research"],
        evidence="quoted from the request",
        justifies_patient_level=False,
        justification_evidence=None,
        source="model",
    )
    fields.update(overrides)
    return PurposeAssessment(**fields)


def _request(requested_as: str) -> DataRequestIn:
    return DataRequestIn(
        purpose="A purpose.",
        question="A question.",
        requested_as=requested_as,
        applicant={"name": "A", "organisation": "Example", "country": "AT"},
    )


def test_articles_follow_the_model_classification_and_the_request_type():
    statistics = _request("health data request")
    access = _request("health data access application")

    rejected = decide(access, _assessment(prohibited=True, prohibited_category="advertising_marketing"))
    assert rejected.decision == "REJECT"
    assert rejected.articles == ["54"]
    assert rejected.branch == 1

    health_data_request = decide(statistics, _assessment())
    assert health_data_request.decision == "APPROVE_STATISTICAL"
    assert health_data_request.articles == ["53", "69"]
    assert health_data_request.branch == 2

    justified = decide(access, _assessment(justifies_patient_level=True, allowed_purposes=["algorithm_development"]))
    assert justified.decision == "APPROVE_SPE"
    assert justified.articles == ["53", "66", "68", "73"]
    assert justified.branch == 3

    not_justified = decide(access, _assessment())
    assert not_justified.decision == "APPROVE_STATISTICAL"
    assert not_justified.articles == ["53", "66", "69"]
    assert not_justified.branch == 4
    assert "records were requested" in not_justified.reason or "not justified" in not_justified.reason
