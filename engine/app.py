from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from engine.config import Settings, settings as default_settings
from engine.db import Database
from engine.package import DistrictPackage
from engine.runtime import Runtime
from core.seismic import Epicentre
from engine.schemas import ClockCommand, DisambiguationResolution, InjectionRequest, OverrideRequest, RawEvent, ScenarioSelection, SeismicRequest, VerificationResult
from exports.cap import render_alerts
from exports.pdf import render_dispatch


def create_app(settings: Settings = default_settings) -> FastAPI:
    package = DistrictPackage.load(settings.district_package)
    runtime = Runtime(package, Database(settings.database_path), settings.checkpoint_interval_minutes)

    def available_scenarios() -> list[dict[str, Any]]:
        rows = []
        for meta_path in sorted(settings.district_package.parent.glob("*/meta.json")):
            try:
                meta = __import__("json").loads(meta_path.read_text(encoding="utf-8"))
                rows.append({"id": meta["id"], "name": meta.get("name", meta["id"]), "historical": bool(meta.get("historical", False)), "replay": meta.get("replay"), "provenance": meta.get("provenance"), "active": meta_path.parent.resolve() == package.root.resolve()})
            except (OSError, ValueError, KeyError):
                continue
        return rows

    async def clock_driver() -> None:
        # One wall second is one clock step. A tick that raises must not take the clock with it:
        # this task is the only thing advancing time, and a dead task looks exactly like a paused
        # demo with no way back short of a restart. So the failure is logged and the clock lives.
        while True:
            await asyncio.sleep(1)
            if not runtime.clock.playing:
                continue
            try:
                runtime.clock.advance_wall_second()
                await runtime.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger("setu.clock").exception("tick failed at t=%s", runtime.clock.current.isoformat())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await runtime.initialise()
        task = asyncio.create_task(clock_driver())
        yield
        task.cancel()
        with suppress(asyncio.CancelledError): await task
        runtime.db.close()

    app = FastAPI(
        title="SETU Engine API", version="0.1.0",
        description="Offline severity estimation, verification, and typed disaster dispatch API. All demo data discloses provenance.",
        lifespan=lifespan,
    )
    app.state.runtime = runtime
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_credentials=True, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "Last-Event-ID"])

    @app.get("/healthz", tags=["system"])
    def health() -> dict[str, Any]:
        return {"status": "ok", "offline_runtime": True, "district": package.meta["id"], "t": runtime.clock.current.isoformat()}

    @app.get("/api/district", tags=["read"])
    def district() -> dict[str, Any]: return package.meta

    @app.get("/api/scenarios", tags=["read"])
    def scenarios() -> list[dict[str, Any]]: return available_scenarios()

    @app.post("/api/scenario", tags=["control"])
    async def select_scenario(selection: ScenarioSelection) -> dict[str, Any]:
        nonlocal package, runtime
        candidates: dict[str, Path] = {}
        for meta_path in settings.district_package.parent.glob("*/meta.json"):
            try: candidates[__import__("json").loads(meta_path.read_text(encoding="utf-8"))["id"]] = meta_path.parent
            except (OSError, ValueError, KeyError): continue
        selected = candidates.get(selection.id)
        if selected is None:
            raise HTTPException(404, "Unknown scenario")
        new_package = DistrictPackage.load(selected)
        db_path = settings.database_path.with_name(f"{settings.database_path.stem}-{selection.id}{settings.database_path.suffix}")
        new_runtime = Runtime(new_package, Database(db_path), settings.checkpoint_interval_minutes)
        await new_runtime.initialise()
        old_runtime = runtime
        package, runtime = new_package, new_runtime
        app.state.runtime = runtime
        old_runtime.db.close()
        return {"selected": selection.id, "reconnect_stream": True, "district": package.meta, "state": runtime.state}

    @app.get("/api/settlements", tags=["read"])
    def settlements(response: Response) -> list[dict[str, Any]]:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return package.settlements

    @app.get("/api/layers", tags=["read"])
    def layers() -> dict[str, Any]:
        path = package.root / "layers" / "index.json"
        if not path.exists(): return {"layers": []}
        return __import__("json").loads(path.read_text(encoding="utf-8"))

    @app.get("/api/layers/{layer_id}", tags=["read"])
    def layer(layer_id: str) -> Response:
        index = layers()
        row = next((item for item in index["layers"] if item["id"] == layer_id), None)
        if row is None: raise HTTPException(404, "Unknown layer")
        path = (package.root / row["path"]).resolve()
        if package.root.resolve() not in path.parents or not path.is_file(): raise HTTPException(404, "Layer unavailable")
        media_type = "application/geo+json" if row["format"] == "geojson" else "application/json"
        headers = {"X-Setu-Provenance": row.get("provenance", "unknown")}
        # The buildings and heightmap layers are stored gzipped because they are the two large ones.
        # Declaring the encoding hands the browser the bytes as they sit on disk and lets it inflate
        # them itself, so the engine never has to hold a decompressed copy.
        if row["format"] == "json.gz":
            headers["Content-Encoding"] = "gzip"
        return Response(path.read_bytes(), media_type=media_type, headers=headers)

    @app.get("/api/atlas", tags=["read"])
    def atlas() -> Response:
        """The state and district geography the Twin flies through before it enters a district.

        Boundaries are archived administrative geometry for every state listed, but only districts
        carrying a ``scenarios`` entry have engine numbers behind them; the atlas says so in its own
        ``provenance`` block so the frontend can label the rest as the stand-ins they are.
        """
        path = settings.district_package.parent / "_atlas" / "atlas.json"
        if not path.exists():
            raise HTTPException(404, "Atlas unavailable; run `python -m scripts.forge.build_atlas`")
        return Response(
            path.read_bytes(), media_type="application/json",
            headers={"X-Setu-Provenance": "archived",
                     "Cache-Control": "public, max-age=31536000, immutable"},
        )

    @app.get("/api/stand-ins", tags=["read"])
    def stand_ins() -> Response:
        """Authored severity for the districts that have no engine behind them.

        Kept in its own file and served under its own ``synthetic`` header rather than folded into
        the atlas, because the atlas's boundaries are archived and a single response must not carry
        one field that was observed and another that was invented.
        """
        path = settings.district_package.parent / "_atlas" / "stand_ins.json"
        if not path.exists():
            raise HTTPException(404, "Stand-in severity unavailable; run `python -m scripts.forge.build_stand_ins`")
        return Response(
            path.read_bytes(), media_type="application/json",
            headers={"X-Setu-Provenance": "synthetic",
                     "Cache-Control": "public, max-age=31536000, immutable"},
        )

    @app.get("/api/timeline", tags=["read"])
    def timeline() -> dict[str, Any]:
        manifest = package.root / "twin_manifest.json"
        return __import__("json").loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {"timestamps": []}

    @app.get("/api/state", tags=["read"])
    async def state(t: datetime | None = None) -> dict[str, Any]:
        if t is not None: return await runtime.seek(t)
        return runtime.state

    @app.get("/api/settlement/{settlement_id}/receipt", tags=["read"])
    def receipt(settlement_id: str, t: datetime | None = None) -> dict[str, Any]:
        try: return runtime.receipt(settlement_id, t)
        except KeyError: raise HTTPException(404, "Unknown settlement")

    @app.get("/api/routes/{settlement_id}", tags=["read"])
    def route(settlement_id: str, asset_kind: Annotated[str, Query(pattern="^(boat|excavator|medical)$")] = "medical") -> dict[str, Any]:
        try: return runtime.route(settlement_id, asset_kind)
        except KeyError: raise HTTPException(404, "Route unavailable")

    @app.get("/api/twin/states", tags=["read"])
    def twin_states(t: datetime | None = None) -> Response:
        path = package.root / "twin_states.bin"
        if not path.exists(): raise HTTPException(404, "Twin state package unavailable")
        manifest_path = package.root / "twin_manifest.json"
        count = len(package.settlements)
        if manifest_path.exists():
            manifest = __import__("json").loads(manifest_path.read_text(encoding="utf-8"))
            requested = t or runtime.clock.current
            times = [datetime.fromisoformat(value) for value in manifest["timestamps"]]
            timestep = min(range(len(times)), key=lambda index: abs((times[index] - requested).total_seconds()))
        else:
            timestep = min(int(max(0, ((t or runtime.clock.current) - runtime.clock.start).total_seconds()) // 3600), 24)
        offset = timestep * count
        data = path.read_bytes()[offset:offset + count]
        return Response(data, media_type="application/octet-stream", headers={"X-Setu-Offset": str(offset), "X-Setu-Count": str(count), "X-Setu-Frame": str(timestep), "Cache-Control": "no-store"})

    @app.get("/api/coverage", tags=["read"])
    def coverage() -> dict[str, Any]:
        """What arrived, what it collapsed to, and where nothing arrived at all."""
        payload = runtime.db.coverage()
        known = {row["id"] for row in package.settlements}
        observability = {row["id"]: row.get("observability") for row in package.settlements}
        rows = [{**row, "observability": observability.get(row["settlement_id"])}
                for row in payload["settlements"] if row["settlement_id"] in known]
        # "No reports" is not the same claim as "silent zone": a village can be quiet because nothing
        # has happened to it. The Twin pairs this list with the belief rows to decide which of these
        # villages is quiet *and* in trouble - that pairing is the Silence map mode.
        without_reports = sorted(known - {row["settlement_id"] for row in rows if row["messages"]})
        return {"totals": {**payload["totals"], "settlements": len(known),
                           "settlements_with_reports": len(known) - len(without_reports),
                           "settlements_without_reports": len(without_reports)},
                "settlements": rows, "without_reports": without_reports}

    @app.get("/api/metrics", tags=["read"])
    def metrics() -> dict[str, Any]: return runtime.metrics()

    @app.get("/api/decisions", tags=["read"])
    def decisions(since: Annotated[int, Query(ge=0)] = 0) -> list[dict[str, Any]]: return runtime.db.decisions(since)

    @app.post("/api/clock", tags=["control"])
    async def clock(command: ClockCommand) -> dict[str, Any]:
        try: runtime.clock.command(command.action, t=command.t, speed=command.speed)
        except ValueError as exc: raise HTTPException(422, str(exc))
        if command.action == "reset": await runtime.reset()
        elif command.action == "seek": await runtime.seek(runtime.clock.current)
        return {"clock": runtime.clock.payload(), "state": runtime.state}

    @app.post("/api/seismic", tags=["control"])
    async def seismic(request: SeismicRequest) -> dict[str, Any]:
        """Shake the loaded district from an epicentre and magnitude.

        Read-only unless ``inject`` is set. The response always carries its own caveats and is
        always marked synthetic: this is a scenario being explored, not an event that happened.
        """
        epicentre = Epicentre(
            lon=request.lon, lat=request.lat,
            magnitude=request.magnitude, depth_km=request.depth_km,
        )
        return await runtime.shake(epicentre, inject=request.inject)

    @app.post("/api/inject", tags=["control"])
    async def inject(request: InjectionRequest) -> dict[str, Any]:
        state = await runtime.inject(request.attack, request.params)
        return {"attack": request.attack, "applied": True, "state": state}

    @app.post("/api/override", tags=["control"])
    def override(request: OverrideRequest) -> dict[str, Any]:
        if not any(row["id"] == request.decision_id for row in runtime.db.decisions()): raise HTTPException(404, "Unknown decision")
        ts = datetime.now().astimezone().isoformat(); override_id = runtime.db.save_override(request.decision_id, request.actor, request.reason, request.outcome, ts)
        return {"id": override_id, "decision_id": request.decision_id, "actor": request.actor, "reason": request.reason, "outcome": request.outcome, "ts": ts}

    @app.post("/api/verify/{verification_id}", tags=["control"])
    async def verify(verification_id: str, result: VerificationResult) -> dict[str, Any]:
        task = next((row for row in runtime.state.get("verify", []) if row["id"] == verification_id), None)
        if task is None: raise HTTPException(404, "Unknown or closed verification task")
        event = RawEvent(kind="verification", channel="verification", source_id=result.actor, provenance="live", settlement_id=task["settlement_id"], result=result.result, params={"failure_mode": "COLLAPSE"}, ts=runtime.clock.current)
        evidence = runtime.ingest_live(event); await runtime.broker.publish(runtime.state)
        return {"verification_id": verification_id, "result": result.result, "evidence": evidence, "state": runtime.state}

    @app.post("/api/events", status_code=202, tags=["live"])
    async def events(event: RawEvent) -> dict[str, Any]:
        evidence = runtime.ingest_live(event); await runtime.broker.publish(runtime.state)
        return {"accepted": True, "obs_id": event.obs_id, "evidence_emitted": len(evidence), "evidence": evidence}

    @app.post("/api/events/batch", status_code=202, tags=["live"])
    async def event_batch(events: list[RawEvent] = Body(min_length=1, max_length=5000)) -> dict[str, Any]:
        accepted = 0; evidence = []
        for event in events:
            rows = runtime.ingest_live(event); accepted += 1; evidence.extend(rows)
        await runtime.broker.publish(runtime.state)
        return {"accepted": accepted, "evidence_emitted": len(evidence), "evidence": evidence}

    @app.get("/api/disambiguation", tags=["live"])
    def disambiguation() -> list[dict[str, Any]]:
        return runtime.db.disambiguation_items()

    @app.post("/api/disambiguation/{obs_id}/resolve", tags=["live"])
    async def resolve_disambiguation(obs_id: str, resolution: DisambiguationResolution) -> dict[str, Any]:
        item = next((row for row in runtime.db.disambiguation_items() if row["obs_id"] == obs_id), None)
        if item is None: raise HTTPException(404, "Unknown disambiguation item")
        if not package.settlement(resolution.settlement_id): raise HTTPException(404, "Unknown settlement")
        raw = item["payload"]
        event = RawEvent(kind=raw["kind"], channel=raw["channel"], source_id=raw["source_id"], provenance=raw["provenance"], settlement_id=resolution.settlement_id, text=raw.get("text_en") or raw.get("text_orig"), hazard=raw.get("hazard", "unknown"), severity_hint=raw.get("severity_hint", "unknown"), is_firsthand=raw.get("is_firsthand", False), ts=runtime.clock.current, obs_id=f"{obs_id}-resolved")
        if not runtime.db.resolve_disambiguation(obs_id): raise HTTPException(409, "Item already resolved")
        evidence = runtime.ingest_live(event); await runtime.broker.publish(runtime.state)
        return {"obs_id": obs_id, "settlement_id": resolution.settlement_id, "actor": resolution.actor, "evidence": evidence, "state": runtime.state}

    @app.get("/api/stream", tags=["live"])
    async def stream(request: Request) -> StreamingResponse:
        return StreamingResponse(runtime.broker.stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/tiles/{tile_path:path}", tags=["static"])
    def tiles(tile_path: str) -> FileResponse:
        root = (package.root / "tiles").resolve(); path = (root / tile_path).resolve()
        if root not in path.parents or not path.is_file(): raise HTTPException(404, "Tile not found")
        return FileResponse(path, media_type="application/octet-stream", headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable"})

    @app.get("/export/dispatch.pdf", tags=["export"])
    def dispatch_pdf() -> Response:
        data = render_dispatch(runtime.state.get("plan", []), runtime.clock.current.isoformat(), package.meta["provenance"]["disclosure"])
        return Response(data, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=setu-dispatch.pdf"})

    @app.get("/export/alerts.cap", tags=["export"])
    def alerts_cap() -> Response:
        return Response(render_alerts(runtime.state.get("plan", []), runtime.clock.current.isoformat()), media_type="application/cap+xml", headers={"Content-Disposition": "attachment; filename=setu-alerts.cap.xml"})

    # The Twin, served from the Engine so the demo is one process and no CDN is ever reached. In dev
    # Vite owns :5173 and proxies here instead, so an absent build is normal, not an error.
    repo = Path(__file__).resolve().parent.parent
    # The San Rita clone is the active operator Twin. Prefer its production build so a judge can run
    # one Engine process and open :8000; retain the older web build only as a compatibility fallback.
    candidates = [repo / "sanrita-clone" / "dist" / "client", repo / "web" / "dist"]
    twin = next((candidate for candidate in candidates if (candidate / "index.html").is_file()), candidates[0])
    if (twin / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=twin / "assets"), name="twin-assets")

        @app.get("/", include_in_schema=False)
        def twin_index() -> FileResponse:
            return FileResponse(twin / "index.html", media_type="text/html")

        @app.get("/{asset_path:path}", include_in_schema=False)
        def twin_asset(asset_path: str) -> FileResponse:
            path = (twin / asset_path).resolve()
            # Single-page app: anything that is not a real file is a route, so hand back the shell.
            if twin in path.parents and path.is_file():
                return FileResponse(path)
            return FileResponse(twin / "index.html", media_type="text/html")

    return app


def get_app() -> FastAPI:
    return create_app()
