from app.nodes.factory import live_warnings, probe_nodes


class _Up:
    name = "Klinikum Nord"
    url = "postgresql://hospital:hospital@db_nord:5432/hospital"

    def patient_count(self) -> int:
        return 10


class _Down:
    name = "Klinikum West"
    url = "postgresql://hospital:hospital@db_west:5432/hospital"

    def patient_count(self) -> int:
        raise OSError("connection refused")


def test_probe_reports_a_down_node_without_dropping_the_others():
    health = probe_nodes([_Up(), _Down()])
    assert health[0]["ok"] is True
    assert health[0]["patients"] == 10
    assert "hospital:" not in health[0]["endpoint"]
    assert health[1]["ok"] is False
    assert health[1]["patients"] is None


def test_live_warnings_keep_the_overlap_warning_and_name_the_down_node():
    warnings = live_warnings(
        {"warnings": ["Patient identity overlap: 2 patient IDs appear in more than one hospital node."]},
        [{"name": "Klinikum West", "ok": False}],
    )
    assert warnings[0].startswith("Patient identity overlap")
    assert "Klinikum West is not reachable" in warnings
