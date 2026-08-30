"""Behavioural checks on the generated replay streams: the demo claims must actually hold."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from core.dedupe import ClaimLike, cluster_weight
from engine.app import create_app
from engine.config import ROOT, Settings
from engine.package import DistrictPackage
from scripts.forge.historical import build_all


VELLARIMALA = "LGD-627340"
PULPALLY = "LGD-627311"


def _client(scenario: str, tmp_path: Path) -> TestClient:
    build_all()
    app = create_app(Settings(
        district_package=ROOT / "district_package" / scenario,
        database_path=tmp_path / f"{scenario}.db",
        allowed_origins=("http://localhost:5173",),
    ))
    return TestClient(app)


def test_streams_are_deterministic_and_disclosed() -> None:
    build_all()
    for scenario in ("wayanad-2018-flood", "wayanad-2019-flood-landslide", "meppadi-2024-landslide"):
        root = ROOT / "district_package" / scenario
        rows = [json.loads(line) for line in (root / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        first = json.dumps(rows, sort_keys=True)
        build_all()
        again = [json.loads(line) for line in (root / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        assert json.dumps(again, sort_keys=True) == first, f"{scenario} stream is not reproducible"
        assert len(rows) >= 200
        assert {row["provenance"] for row in rows} <= {"archived", "synthetic"}
        assert all(row["obs_id"] for row in rows)
        assert rows == sorted(rows, key=lambda row: row["t"])
        meta = json.loads((root / "meta.json").read_text(encoding="utf-8"))
        disclosure = meta["event_streams"]
        assert disclosure["by_provenance"]["synthetic"] > 0
        assert "simulated" in disclosure["synthetic"] and disclosure["personal_data"] is False
        archived = [row for row in rows if row["provenance"] == "archived"]
        # An archived row is either a district aggregate (which must never be projected onto a
        # village) or a memorandum fact that names its settlement outright. Nothing in between.
        assert archived
        assert all(row.get("params", {}).get("scope") == "district" or row.get("settlement_id") for row in archived)


def test_cascade_edges_only_run_downhill() -> None:
    package = DistrictPackage.load(ROOT / "district_package" / "meppadi-2024-landslide")
    elevation = {row["id"]: row["elevation_m"] for row in package.settlements}
    assert len(package.cascade_edges) >= 20
    for edge in package.cascade_edges:
        assert elevation[edge.source] - elevation[edge.destination] >= 15.0
        assert 20 <= edge.lag_minutes <= 360 and 0.0 < edge.transfer_weight <= 0.85


def test_corroboration_raises_weight_but_volume_does_not() -> None:
    base = "we saw the slope come down at Vellarimala houses buried and people trapped near the estate line"
    variant = base.replace("estate", "school")
    witnesses = [
        ClaimLike("a", base, "HAM-VU2WYD", "ham", True, "severe", "t1"),
        ClaimLike("b", variant, "ASHA-WYD-104", "voice", True, "severe", "t2"),
        ClaimLike("c", base, "FIRE-KALPETTA", "sms", True, "catastrophic", "t3"),
    ]
    hint, independent, firsthand = cluster_weight(witnesses)
    assert (hint, independent, firsthand) == ("catastrophic", 3, True)
    forwards = [ClaimLike(str(i), "forwarded as received the dam has breached", f"CIV-{i:04d}", "whatsapp", False, "severe", "t") for i in range(24)]
    hint, independent, firsthand = cluster_weight(forwards)
    assert (hint, independent, firsthand) == ("severe", 1, False)


def test_replay_separates_a_destroyed_village_from_a_rumour(tmp_path: Path) -> None:
    with _client("wayanad-2019-flood-landslide", tmp_path) as client:
        state = client.post("/api/clock", json={"action": "seek", "t": "2019-08-08T23:30:00+05:30"}).json()["state"]
        beliefs = {(row["settlement_id"], row["failure_mode"]): row["probability"] for row in state["beliefs"]}
        assert beliefs[(VELLARIMALA, "LANDSLIDE")] > 0.75
        assert beliefs[(PULPALLY, "INUNDATION")] < 0.60, "24 forwards must not carry a village on their own"
        receipt = client.get(f"/api/settlement/{VELLARIMALA}/receipt", params={"t": "2019-08-08T23:30:00+05:30"}).json()
        body = json.dumps(receipt)
        assert "human_report" in body and "verification" in body
        queue = client.get("/api/disambiguation").json()
        assert len(queue) >= 3, "reports with no gazetteer match must wait for a human"
        claims = [row for row in client.get("/api/decisions").json() if row]
        assert claims is not None


def test_normality_and_silence_are_both_visible(tmp_path: Path) -> None:
    with _client("meppadi-2024-landslide", tmp_path) as client:
        calm = client.post("/api/clock", json={"action": "seek", "t": "2024-07-29T12:00:00+05:30"}).json()["state"]
        quiet = [row for row in calm["beliefs"] if row["settlement_id"] != VELLARIMALA and row["failure_mode"] == "INUNDATION"]
        assert quiet and max(row["probability"] for row in quiet) < 0.35, "normal attach counts must argue against failure"
        after = client.post("/api/clock", json={"action": "seek", "t": "2024-07-30T09:00:00+05:30"}).json()["state"]
        severe = next(row for row in after["beliefs"] if row["settlement_id"] == VELLARIMALA and row["failure_mode"] == "LANDSLIDE")
        assert severe["probability"] > 0.75
        assert any(task["settlement_id"] == VELLARIMALA for task in after["plan"])
        metrics = client.get("/api/metrics").json()
        assert metrics
