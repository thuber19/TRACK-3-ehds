import json

from fastapi.testclient import TestClient

from app.config import Settings, find_root
from app.main import create_app

ROOT = find_root()


def _client(tmp_path):
    settings = Settings.from_env()
    settings = Settings(
        data_mode="csv",
        hospital_nodes=[],
        openai_api_key="",
        openai_model=settings.openai_model,
        session_secret="test-secret",
        root=settings.root,
        data_dir=settings.data_dir,
        requests_dir=settings.requests_dir,
        var_dir=tmp_path,
        frontend_dist=tmp_path / "missing-frontend",
        seed_applicant_username="applicant",
        seed_applicant_password="applicant",
        seed_staff_username="staff",
        seed_staff_password="staff",
    )
    application = create_app(settings)
    return TestClient(application)


def test_a_request_is_not_answered_without_a_model(tmp_path):
    client = _client(tmp_path)
    payload = json.loads((ROOT / "requests" / "R01.json").read_text(encoding="utf-8"))
    with client:
        assert client.post("/api/auth/login", json={"username": "applicant", "password": "applicant"}).status_code == 200
        response = client.post("/api/requests", json=payload)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ERROR"
        assert body["answer"] is None
        assert body["decision"] is None

        client.post("/api/auth/logout")
        assert client.post("/api/auth/login", json={"username": "staff", "password": "staff"}).status_code == 200
        detail = client.get(f"/api/requests/{body['id']}").json()
        steps = [event["step"] for event in detail["events"]]
        assert "purpose_check" in steps
        assert any(event["step"] == "purpose_check" and event["status"] == "error" for event in detail["events"])

        blocked = client.post(f"/api/spe/{body['id']}/download")
        assert blocked.status_code == 403
        assert "cannot leave" in blocked.json()["detail"]
        exported = client.get(f"/api/spe/{body['id']}/export")
        assert exported.status_code == 403
