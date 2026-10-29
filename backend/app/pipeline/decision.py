"""The four-branch decision. The model classifies the purpose. This module only cites the articles."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.pipeline.spec import DataRequestIn

PHRASES = {
    "research": "Research",
    "public_health": "public health",
    "policy_making": "Policy-making",
    "patient_care_improvement": "improving care",
    "official_statistics": "Official statistics",
    "education": "Teaching",
    "algorithm_development": "Training and testing algorithms",
}


@dataclass
class PurposeAssessment:
    prohibited: bool
    prohibited_category: str | None
    allowed_purposes: list[str]
    evidence: str | None
    justifies_patient_level: bool
    justification_evidence: str | None
    prohibited_confident: bool = False
    allowed_confident: bool = False
    justification_confident: bool = False
    source: str = "model"


@dataclass
class Decision:
    decision: str
    articles: list[str]
    reason: str
    branch: int
    purposes: list[str] = field(default_factory=list)


def decide(request: DataRequestIn, assessment: PurposeAssessment) -> Decision:
    purposes = _reason_purposes(assessment.allowed_purposes)
    if assessment.prohibited:
        return Decision(
            decision="REJECT",
            articles=["54"],
            reason=_prohibited_reason(assessment.prohibited_category, request),
            branch=1,
            purposes=purposes,
        )
    requested = request.requested_as.lower()
    if "access application" not in requested:
        return Decision(
            decision="APPROVE_STATISTICAL",
            articles=["53", "69"],
            reason=f"{_purpose_sentence(purposes)} Statistics answer the question (Art. 69).",
            branch=2,
            purposes=purposes,
        )
    if assessment.justifies_patient_level:
        if "algorithm_development" in purposes:
            middle = (
                "The model needs patient-level data, so pseudonymised data is justified (Art. 66). "
                "Access only under a data permit inside a secure processing environment (Art. 68, 73)."
            )
        else:
            middle = (
                "Patient-level data is justified because statistics cannot answer the question (Art. 66). "
                "Access only under a data permit inside a secure processing environment (Art. 68, 73)."
            )
        return Decision(
            decision="APPROVE_SPE",
            articles=["53", "66", "68", "73"],
            reason=f"{_purpose_sentence(purposes)} {middle}",
            branch=3,
            purposes=purposes,
        )
    return Decision(
        decision="APPROVE_STATISTICAL",
        articles=["53", "66", "69"],
        reason=(
            f"{_purpose_sentence(purposes)} Statistics answer the question, so pseudonymised records "
            "are not justified (Art. 66). Approved as statistics instead (Art. 69)."
        ),
        branch=4,
        purposes=purposes,
    )


def _reason_purposes(purposes: list[str]) -> list[str]:
    if "algorithm_development" in purposes:
        return ["algorithm_development"]
    if "official_statistics" in purposes:
        return ["official_statistics"]
    if "education" in purposes and "research" in purposes:
        return ["education", "research"]
    order = [
        "research",
        "public_health",
        "policy_making",
        "patient_care_improvement",
        "education",
        "algorithm_development",
        "official_statistics",
    ]
    chosen = [purpose for purpose in order if purpose in purposes]
    return chosen or ["research"]


def _purpose_sentence(purposes: list[str]) -> str:
    if purposes == ["official_statistics"]:
        return "Official statistics are an allowed purpose (Art. 53)."
    if purposes == ["algorithm_development"]:
        return "Training and testing algorithms is an allowed purpose (Art. 53)."
    phrases = []
    for index, purpose in enumerate(purposes):
        phrase = PHRASES.get(purpose, purpose.replace("_", " "))
        if index:
            phrase = phrase[:1].lower() + phrase[1:]
        phrases.append(phrase)
    if len(phrases) == 1:
        return f"{phrases[0]} is an allowed purpose (Art. 53)."
    if len(phrases) == 2:
        body = f"{phrases[0]} and {phrases[1]}"
    else:
        body = ", ".join(phrases[:-1]) + " and " + phrases[-1]
    return f"{body} are allowed purposes (Art. 53)."


def _prohibited_reason(category: str | None, request: DataRequestIn) -> str:
    text = f"{request.purpose} {request.question}".lower()
    if category == "insurance_premiums":
        return "Using health data to set insurance premiums is prohibited (Art. 54)."
    if category == "advertising_marketing":
        return "Advertising and marketing are prohibited (Art. 54)."
    if category == "employment_decisions":
        reason = "Using health data for decisions about employees is prohibited (Art. 54)."
        if "employee list" in text or "match" in text:
            reason += " Matching it with an employee list would also re-identify people."
        return reason
    if category == "harmful_products":
        if "nicotine" in text or "tobacco" in text:
            return "Developing or marketing nicotine products is prohibited (Art. 54)."
        return "Developing or marketing products that can harm health is prohibited (Art. 54)."
    if category == "reidentification":
        return "Re-identifying people from health data is prohibited (Art. 54)."
    return "This secondary use is prohibited (Art. 54)."

