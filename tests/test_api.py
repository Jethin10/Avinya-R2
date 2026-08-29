from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient

from engine.app import create_app
from engine.config import Settings
from scripts.forge.run_all import build


def make_client(tmp_path: Path) -> TestClient:
    package = build(tmp_path / "district")
    app = create_app(Settings(district_package=package, database_path=tmp_path / "test.db", allowed_origins=("http://localhost:5173",), checkpoint_interval_minutes=15))
    return TestClient(app)


def test_read_surface_and_frontend_contract(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        assert client.get("/healthz").json()["offline_runtime"] is True
        district = client.get("/api/district").json(); assert district["counts"]["settlements"] == 214
        settlements = client.get("/api/settlements"); assert len(settlements.json()) == 214
        assert "immutable" in settlements.headers["cache-control"]
        state = client.get("/api/state").json(); assert len(state["beliefs"]) == 214 * 5
        assert state["plan"] and state["verify"] and state["provenance"]["scenario"] == "synthetic"


def test_replay_seek_receipt_and_typed_dispatch(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        district = client.get("/api/district").json()
        target = "2024-07-30T04:00:00+05:30"
        state = client.post("/api/clock", json={"action": "seek", "t": target}).json()["state"]
        bhimsar = [b for b in state["beliefs"] if b["settlement_id"] == "BH-042"]
        assert max(b["probability"] for b in bhimsar) > 0.75
        receipt = client.get("/api/settlement/BH-042/receipt", params={"t": target}).json()
        assert receipt["prior"] and len(receipt["evidence"]) >= 3 and receipt["posterior"]
        assert any(task["asset_kind"] in {"boat", "excavator", "medical"} for task in state["plan"])


def test_live_event_moves_belief_and_unknown_location_is_quarantined(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        before = client.get("/api/settlement/KH-017/receipt").json()["posterior"]
        response = client.post("/api/events", json={"kind": "report", "channel": "ham", "source_id": "field-1", "provenance": "live", "text": "I saw severe flooding in Kharsa, people trapped", "hazard": "flood", "severity_hint": "severe", "is_firsthand": True})
        assert response.status_code == 202 and response.json()["evidence_emitted"] == 1
        after = client.get("/api/settlement/KH-017/receipt").json()["posterior"]
        before_p = next(row["probability"] for row in before if row["failure_mode"] == "INUNDATION")
        after_p = next(row["probability"] for row in after if row["failure_mode"] == "INUNDATION")
        assert after_p > before_p
        ambiguous = client.post("/api/events", json={"kind": "report", "channel": "sms", "source_id": "x", "provenance": "live", "text": "severe damage near an unknown place"})
        assert ambiguous.json()["evidence_emitted"] == 0
        queued = client.get("/api/disambiguation").json(); assert len(queued) == 1
        resolved = client.post(f"/api/disambiguation/{queued[0]['obs_id']}/resolve", json={"settlement_id": "ME-008", "actor": "operator"})
        assert resolved.status_code == 200 and resolved.json()["evidence"]


def test_live_evidence_survives_seek_and_reset_restores_baseline(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        event = {"kind": "report", "channel": "ham", "source_id": "field-2", "provenance": "live", "settlement_id": "KH-017", "text": "I saw severe flood", "hazard": "flood", "severity_hint": "severe", "is_firsthand": True}
        client.post("/api/events", json=event)
        moved = client.get("/api/settlement/KH-017/receipt").json()["evidence"]
        current_t = client.get("/api/state").json()["t"]
        client.post("/api/clock", json={"action": "seek", "t": current_t})
        replayed = client.get("/api/settlement/KH-017/receipt").json()["evidence"]
        assert len(replayed) == len(moved)
        client.post("/api/clock", json={"action": "reset"})
        assert client.get("/api/settlement/KH-017/receipt").json()["evidence"] == []


def test_verification_injection_exports_and_hash_chain(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        state = client.get("/api/state").json(); task = state["verify"][0]
        verified = client.post(f"/api/verify/{task['id']}", json={"result": "confirmed_severe", "actor": "team-a"})
        assert verified.status_code == 200 and verified.json()["evidence"]
        injected = client.post("/api/inject", json={"attack": "false_reports", "params": {"count": 50, "settlement_id": "BH-042"}})
        assert injected.status_code == 200 and injected.json()["applied"] is True
        decisions = client.get("/api/decisions").json(); assert len(decisions) >= 2
        for previous, current in zip(decisions, decisions[1:]): assert current["prev_hash"] == previous["entry_hash"]
        pdf = client.get("/export/dispatch.pdf"); assert pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
        cap = client.get("/export/alerts.cap"); assert b"urn:oasis:names:tc:emergency:cap:1.2" in cap.content and b"<alert" in cap.content
        twin = client.get("/api/twin/states"); assert len(twin.content) == 214


def test_openapi_contract_is_stable_and_cors_enabled(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        schema = client.get("/openapi.json").json()
        required = {"/api/state", "/api/events", "/api/stream", "/api/clock", "/api/settlement/{settlement_id}/receipt"}
        assert required <= set(schema["paths"])
        options = client.options("/api/state", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        assert options.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_golden_replay_top10_and_metrics(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        state = client.get("/api/state", params={"t": "2024-07-30T08:00:00+05:30"}).json()
        scores: dict[str, float] = {}
        for row in state["beliefs"]:
            scores[row["settlement_id"]] = max(scores.get(row["settlement_id"], 0), row["probability"])
        actual = [sid for sid, _ in sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:10]]
        expected = json.loads((Path(__file__).parent / "golden" / "expected_top10.json").read_text())
        assert actual == expected
        metrics = client.get("/api/metrics").json()
        assert metrics["operational"]["top_k_recall"] == 1.0
        assert metrics["operational"]["silent_zone_recall"] > 0
        assert metrics["calibration"]["ece"] is not None and metrics["calibration"]["curve"]
