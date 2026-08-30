from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from engine.app import create_app
from engine.config import ROOT, Settings
from engine.package import DistrictPackage
from ingest.connectors import read_cap, read_jsonl, read_machine_csv, read_odk, read_whatsapp
from scripts.forge.fetch_sources import fetch
from scripts.forge.historical import build_all


def test_official_sources_verify_and_packages_are_reproducible() -> None:
    manifest = json.loads((ROOT / "data" / "source_manifest.json").read_text(encoding="utf-8"))
    verified = fetch(download=False)
    assert len(verified) == len(manifest["sources"]) and len(verified) >= 6
    assert all(row["sha256"] for row in verified)
    outputs = build_all()
    assert {path.name for path in outputs} == {"wayanad-2018-flood", "wayanad-2019-flood-landslide", "meppadi-2024-landslide"}
    for path in outputs:
        package = DistrictPackage.load(path)
        assert len(package.settlements) == 49
        assert all(row["provenance"] == "archived" for row in package.settlements)
        assert all(row["geometry"]["type"] in {"Polygon", "MultiPolygon"} for row in package.settlements)
        assert all(row["population"] > 0 for row in package.settlements)
        assert (path / "layers" / "settlements.geojson").exists()
        assert (path / "routes.json.gz").exists()
        assert len(package.routes["routes"]["medical"]) == 49
        manifest = json.loads((path / "twin_manifest.json").read_text())
        assert (path / "twin_states.bin").stat().st_size == manifest["frame_count"] * 49


def test_historical_catalog_layers_timeline_and_switch(tmp_path: Path) -> None:
    build_all()
    app = create_app(Settings(
        district_package=ROOT / "district_package" / "meppadi-2024-landslide",
        database_path=tmp_path / "historical.db",
        allowed_origins=("http://localhost:5173",),
    ))
    with TestClient(app) as client:
        scenarios = client.get("/api/scenarios").json()
        assert {row["id"] for row in scenarios if row["historical"]} >= {"wayanad-2018-flood", "wayanad-2019-flood-landslide", "meppadi-2024-landslide"}
        assert client.get("/api/layers/settlements").headers["content-type"].startswith("application/geo+json")
        timeline = client.get("/api/timeline").json(); assert timeline["frame_count"] == 5
        twin = client.get("/api/twin/states", params={"t": "2024-07-30T01:15:00+05:30"})
        assert len(twin.content) == 49 and twin.headers["x-setu-frame"] == "2"
        switched = client.post("/api/scenario", json={"id": "wayanad-2019-flood-landslide"})
        assert switched.status_code == 200 and switched.json()["reconnect_stream"] is True
        assert client.get("/api/district").json()["id"] == "wayanad-2019-flood-landslide"
        assert client.get("/api/timeline").json()["frame_count"] == 6
        state = client.post("/api/clock", json={"action": "seek", "t": "2019-08-08T18:00:00+05:30"}).json()["state"]
        severe = next(row for row in state["beliefs"] if row["settlement_id"] == "LGD-627340" and row["failure_mode"] == "LANDSLIDE")
        assert severe["probability"] > 0.7
        route = client.get("/api/routes/LGD-627340", params={"asset_kind": "excavator"}).json()
        assert route["distance_km"] > 20 and route["geometry"]["type"] == "LineString"
        assert route["assessment"]["status"] in {"open", "degraded", "blocked"}


def test_file_connectors_normalize_to_raw_events(tmp_path: Path) -> None:
    (tmp_path / "events.jsonl").write_text('{"kind":"report","provenance":"live","text":"flood"}\n')
    (tmp_path / "machine.csv").write_text("kind,channel,settlement_id,observed,expected,provenance\ntelemetry,telecom,LGD-627340,0,10,live\n")
    (tmp_path / "odk.json").write_text('[{"_id":"x","report":"road flooded","settlement_id":"LGD-627340"}]')
    (tmp_path / "wa.txt").write_text("30/07/2024, 02:10 - Operator: Mundakkai road blocked")
    (tmp_path / "cap.xml").write_text('<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><sender>ksdma</sender><sent>2024-07-30T02:00:00+05:30</sent><info><event>Flood</event><severity>Severe</severity><description>Evacuate</description><area><areaDesc>Meppadi</areaDesc></area></info></alert>')
    assert len(read_jsonl(tmp_path / "events.jsonl")) == 1
    assert read_machine_csv(tmp_path / "machine.csv")[0].observed == 0
    assert read_odk(tmp_path / "odk.json")[0].channel == "odk"
    assert read_whatsapp(tmp_path / "wa.txt")[0].source_id == "Operator"
    assert read_cap(tmp_path / "cap.xml")[0].hazard == "flood"
