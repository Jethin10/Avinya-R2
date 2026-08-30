from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from core.seismic import (
    Epicentre,
    caveats,
    collapse_probability,
    modified_mercalli,
    peak_ground_acceleration,
    shake,
    site_factor,
    slope_vs30,
    surface_distance_km,
)
from engine.app import create_app
from engine.config import ROOT, Settings
from scripts.forge.run_all import build


def make_client(tmp_path: Path) -> TestClient:
    package = build(tmp_path / "district")
    return TestClient(create_app(Settings(
        district_package=package, database_path=tmp_path / "seismic.db",
        allowed_origins=("http://localhost:5173",), checkpoint_interval_minutes=15,
    )))


def test_ground_motion_falls_off_with_distance_and_rises_with_magnitude() -> None:
    near = peak_ground_acceleration(6.5, 5.0, 10.0)
    far = peak_ground_acceleration(6.5, 80.0, 10.0)
    assert near > far > 0
    assert peak_ground_acceleration(7.0, 20.0, 10.0) > peak_ground_acceleration(5.5, 20.0, 10.0)
    # A deeper focus puts more rock between the rupture and the village.
    assert peak_ground_acceleration(6.5, 5.0, 60.0) < near


def test_ground_motion_is_finite_directly_beneath_the_epicentre() -> None:
    assert 0 < peak_ground_acceleration(6.5, 0.0, 1.0) < 5.0


def test_site_response_amplifies_soft_ground_and_damps_steep_rock() -> None:
    assert slope_vs30(0.05) < slope_vs30(30.0)
    assert site_factor(0.05) > 1.0 > site_factor(30.0)


def test_intensity_is_clamped_to_the_scale() -> None:
    assert modified_mercalli(0.0) == 1.0
    assert modified_mercalli(1e-6) == 2.0
    assert modified_mercalli(5.0) <= 10.0
    assert modified_mercalli(0.3) > modified_mercalli(0.05)


def test_weak_construction_collapses_at_lower_shaking() -> None:
    assert collapse_probability(0.25, kutcha_fraction=1.0) > collapse_probability(0.25, kutcha_fraction=0.0)
    assert collapse_probability(0.0, 0.5) == 0.0
    assert collapse_probability(3.0, 0.5) > 0.95


def test_distance_is_symmetric_and_zero_at_a_point() -> None:
    assert surface_distance_km(76.0, 11.5, 76.0, 11.5) == 0.0
    assert surface_distance_km(76.0, 11.5, 76.5, 11.5) == pytest.approx(
        surface_distance_km(76.5, 11.5, 76.0, 11.5)
    )


def test_extrapolation_beyond_the_fitted_band_is_disclosed() -> None:
    inside = caveats(Epicentre(lon=76.1, lat=11.6, magnitude=6.4, depth_km=12))
    outside = caveats(Epicentre(lon=76.1, lat=11.6, magnitude=8.6, depth_km=90))
    assert len(outside) > len(inside)
    assert any("extrapolated" in note for note in outside)
    assert all("extrapolated" not in note for note in inside)


def test_shake_ranks_by_shaking_and_covers_every_settlement(tmp_path: Path) -> None:
    settlements = json.loads(
        (build(tmp_path / "district") / "settlements.json").read_text(encoding="utf-8")
    )
    rows = shake(Epicentre(lon=76.13, lat=11.55, magnitude=6.4, depth_km=12), settlements)
    assert len(rows) == len(settlements)
    assert [row["pga_g"] for row in rows] == sorted((row["pga_g"] for row in rows), reverse=True)
    assert rows[0]["distance_km"] < rows[-1]["distance_km"]
    assert all(0.0 <= row["collapse_probability"] <= 1.0 for row in rows)


def test_seismic_endpoint_is_read_only_until_asked_to_inject(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        before = client.get("/api/metrics").json()["robustness"]["injected_events"]
        body = {"lon": 76.13, "lat": 11.55, "magnitude": 6.4, "depth_km": 12}
        response = client.post("/api/seismic", json=body).json()
        assert response["provenance"] == "synthetic"
        assert response["injected"] is False
        assert response["caveats"] and response["settlements"]
        assert client.get("/api/metrics").json()["robustness"]["injected_events"] == before

        injected = client.post("/api/seismic", json={**body, "inject": True}).json()
        assert injected["injected"] is True and injected["reports_injected"] > 0
        after = client.get("/api/metrics").json()["robustness"]["injected_events"]
        assert after > before
        # Shaking has to arrive as collapse and slope failure, the modes the engine already
        # dispatches for: an earthquake must never invent a sixth failure mode.
        modes = {row["failure_mode"] for row in injected["state"]["beliefs"]}
        assert "EARTHQUAKE" not in modes
        assert {task["asset_kind"] for task in injected["state"]["plan"]} <= {"boat", "excavator", "medical"}


def test_seismic_request_rejects_impossible_epicentres(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        assert client.post("/api/seismic", json={"lon": 76.1, "lat": 11.6, "magnitude": 12}).status_code == 422
        assert client.post("/api/seismic", json={"lon": 400, "lat": 11.6, "magnitude": 6}).status_code == 422


def test_atlas_endpoint_reports_absence_rather_than_guessing(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.get("/api/atlas")
        # The tmp package has no sibling _atlas directory, so the engine must say so and name the
        # Forge step that produces one rather than serving an empty map.
        assert response.status_code == 404
        assert "build_atlas" in response.json()["detail"]


def test_shipped_atlas_marks_only_packaged_districts_as_live() -> None:
    path = ROOT / "district_package" / "_atlas" / "atlas.json"
    if not path.exists():
        pytest.skip("atlas not built in this checkout")
    atlas = json.loads(path.read_text(encoding="utf-8"))
    assert atlas["provenance"]["boundaries"] == "archived"
    packaged = {
        directory.name for directory in (ROOT / "district_package").iterdir()
        if (directory / "meta.json").exists()
    }
    live = [
        (state["id"], district["id"], district["scenarios"])
        for state in atlas["states"] for district in state["districts"] if district["scenarios"]
    ]
    assert live, "atlas claims no district has engine numbers behind it"
    for _, _, scenarios in live:
        assert set(scenarios) <= packaged, "atlas promises a scenario the repository does not ship"
    for state in atlas["states"]:
        assert state["rings"] and state["districts"]
        assert state["live_district_count"] == sum(
            1 for district in state["districts"] if district["scenarios"]
        )


def test_gzipped_layers_are_served_with_their_encoding_declared() -> None:
    """Buildings and the heightmap sit on disk gzipped and are handed over that way.

    The engine must never inflate them into memory to serve them, so the only thing that makes the
    bytes readable in a browser is the ``Content-Encoding`` header. A regression here looks like a
    working endpoint returning garbage, which is why it is asserted rather than assumed.
    """
    package = ROOT / "district_package" / "wayanad-2018-flood"
    if not (package / "layers" / "buildings.json.gz").exists():
        pytest.skip("buildings layer not built in this checkout")
    index = json.loads((package / "layers" / "index.json").read_text(encoding="utf-8"))
    registered = {layer["id"]: layer for layer in index["layers"]}
    assert {"buildings", "heightmap"} <= set(registered), "a Forge step unregistered its own layer"

    client = TestClient(create_app(Settings(
        district_package=package, database_path=ROOT / "data" / "derived" / "layer-probe.db",
        allowed_origins=("http://localhost:5173",), checkpoint_interval_minutes=15,
    )))
    try:
        with client:
            for layer_id in ("buildings", "heightmap"):
                response = client.get(f"/api/layers/{layer_id}")
                assert response.status_code == 200
                assert response.headers["x-setu-provenance"] == "archived"
                # httpx transparently inflates, so the proof the header was set is that it parsed.
                payload = response.json()
                assert payload
            assert client.get("/api/layers/not-a-layer").status_code == 404
    finally:
        (ROOT / "data" / "derived" / "layer-probe.db").unlink(missing_ok=True)


def test_stand_in_severity_never_covers_a_district_the_engine_speaks_for() -> None:
    """The authored map and the computed one must not overlap.

    A district with a package behind it gets its severity from the belief engine. If it also had a
    stand-in row, the frontend would have two numbers for one field and no way to say which it was
    showing - which is the exact failure the provenance rule exists to prevent.
    """
    path = ROOT / "district_package" / "_atlas" / "stand_ins.json"
    if not path.exists():
        pytest.skip("stand-ins not built in this checkout")
    stand_ins = json.loads(path.read_text(encoding="utf-8"))
    atlas = json.loads((ROOT / "district_package" / "_atlas" / "atlas.json").read_text(encoding="utf-8"))

    assert stand_ins["provenance"]["severity"] == "synthetic"
    assert stand_ins["provenance"]["disclosure"]
    live = {f"{state['id']}/{district['id']}"
            for state in atlas["states"] for district in state["districts"] if district["scenarios"]}
    assert live, "atlas claims no district has engine numbers behind it"
    assert not live & set(stand_ins["districts"]), "a live district also carries authored severity"

    for key, row in stand_ins["districts"].items():
        assert key == f"{row['state_id']}/{row['district_id']}"
        assert 0.0 <= row["severity"] <= 1.0
        assert row["provenance"] == "synthetic" and row["confidence"] == "none"
        assert row["failure_mode"] in {"INUNDATION", "COLLAPSE", "CASUALTY", "LANDSLIDE", "WIND"}
        assert row["asset_kind"] in {"boat", "excavator", "medical"}
        assert row["settlements_severe"] <= row["settlements_estimated"]
    # Every state in the atlas is accounted for, and the counts agree with the district rows.
    assert set(stand_ins["states"]) == {state["id"] for state in atlas["states"]}
    for state_id, summary in stand_ins["states"].items():
        assert summary["stand_in_districts"] == sum(
            1 for row in stand_ins["districts"].values() if row["state_id"] == state_id
        )


def test_stand_in_generation_is_reproducible() -> None:
    """A rebuild has to produce the same map, or a demo is a different demo every time."""
    path = ROOT / "district_package" / "_atlas" / "stand_ins.json"
    if not path.exists():
        pytest.skip("stand-ins not built in this checkout")
    from scripts.forge.build_stand_ins import build

    before = path.read_bytes()
    assert build().read_bytes() == before


def test_stand_ins_endpoint_declares_itself_synthetic(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.get("/api/stand-ins")
        assert response.status_code == 404
        assert "build_stand_ins" in response.json()["detail"]

    package = ROOT / "district_package" / "wayanad-2018-flood"
    if not (ROOT / "district_package" / "_atlas" / "stand_ins.json").exists():
        pytest.skip("stand-ins not built in this checkout")
    client = TestClient(create_app(Settings(
        district_package=package, database_path=tmp_path / "stand-ins.db",
        allowed_origins=("http://localhost:5173",), checkpoint_interval_minutes=15,
    )))
    with client:
        response = client.get("/api/stand-ins")
        assert response.status_code == 200
        assert response.headers["x-setu-provenance"] == "synthetic"
        assert response.json()["districts"]
