"""Build deterministic offline routes from the pinned OpenStreetMap road snapshot."""

from __future__ import annotations

import gzip
import hashlib
import heapq
import json
import math
import re
from pathlib import Path
from typing import Any

from engine.config import ROOT
from scripts.forge.historical import official_settlements


SOURCE = ROOT / "data" / "sources" / "osm_wayanad_roads.json"
DERIVED = ROOT / "data" / "derived"
BASE_SETTLEMENT = "LGD-913291"  # Kalpetta district emergency operations base
SPEED_KPH = {
    "motorway": 80, "trunk": 65, "primary": 50, "secondary": 42,
    "tertiary": 35, "unclassified": 28, "residential": 24,
    "service": 18, "track": 12, "living_street": 12, "road": 18,
}
ASSET_FACTOR = {"medical": 1.0, "excavator": 0.55, "boat": 0.7}


def _haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, a); lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(value))


def _speed(tags: dict[str, str]) -> float:
    raw = tags.get("maxspeed", "")
    match = re.search(r"\d+", raw)
    return float(match.group()) if match else SPEED_KPH.get(tags.get("highway", "road"), 18)


def _edge_penalty(tags: dict[str, str], asset: str) -> float | None:
    if tags.get("access") in {"no", "private"} or tags.get("motor_vehicle") == "no":
        return None
    highway = tags.get("highway", "road")
    penalty = 1.0
    if asset == "medical" and highway == "track": penalty *= 2.5
    if asset == "excavator" and tags.get("bridge") not in {None, "no"}: penalty *= 1.25
    if tags.get("surface") in {"unpaved", "gravel", "dirt", "ground", "mud", "sand"}:
        penalty *= {"medical": 1.8, "excavator": 1.35, "boat": 1.5}[asset]
    if tags.get("ford") not in {None, "no"}: penalty *= {"medical": 4.0, "excavator": 2.5, "boat": 0.8}[asset]
    return penalty


def _nearest_node(point: tuple[float, float], nodes: dict[int, tuple[float, float]]) -> int:
    # Equirectangular prefilter is exact enough at district scale and deterministic.
    lon, lat = point; scale = math.cos(math.radians(lat))
    return min(nodes, key=lambda node: ((nodes[node][0] - lon) * scale) ** 2 + (nodes[node][1] - lat) ** 2)


def _dijkstra(graph: dict[int, list[tuple[int, float, int, dict[str, str]]]], start: int, asset: str):
    distances = {start: 0.0}; previous: dict[int, tuple[int, int, dict[str, str], float]] = {}
    queue = [(0.0, start)]
    while queue:
        distance, node = heapq.heappop(queue)
        if distance != distances.get(node): continue
        for neighbour, length_m, way_id, tags in graph.get(node, []):
            penalty = _edge_penalty(tags, asset)
            if penalty is None: continue
            minutes = length_m / (_speed(tags) * ASSET_FACTOR[asset] * 1000 / 60) * penalty
            candidate = distance + minutes
            if candidate < distances.get(neighbour, float("inf")):
                distances[neighbour] = candidate
                previous[neighbour] = (node, way_id, tags, length_m)
                heapq.heappush(queue, (candidate, neighbour))
    return distances, previous


def _reconstruct(previous: dict[int, tuple[int, int, dict[str, str], float]], start: int, end: int):
    edges = []
    node = end
    while node != start and node in previous:
        parent, way_id, tags, length = previous[node]
        edges.append((parent, node, way_id, tags, length)); node = parent
    if node != start: return []
    return list(reversed(edges))


def build() -> Path:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    nodes = {int(row["id"]): (float(row["lon"]), float(row["lat"])) for row in payload["elements"] if row["type"] == "node"}
    ways = [row for row in payload["elements"] if row["type"] == "way" and len(row.get("nodes", [])) > 1]
    graph: dict[int, list[tuple[int, float, int, dict[str, str]]]] = {}
    segment_count = 0
    for way in ways:
        tags = {str(key): str(value) for key, value in way.get("tags", {}).items()}
        oneway = tags.get("oneway") in {"yes", "1", "true"} or tags.get("junction") == "roundabout"
        reverse = tags.get("oneway") == "-1"
        for left, right in zip(way["nodes"], way["nodes"][1:]):
            left = int(left); right = int(right)
            if left not in nodes or right not in nodes: continue
            length = _haversine(nodes[left], nodes[right]); segment_count += 1
            if not reverse: graph.setdefault(left, []).append((right, length, int(way["id"]), tags))
            if not oneway or reverse: graph.setdefault(right, []).append((left, length, int(way["id"]), tags))
    settlements, _ = official_settlements()
    snaps = {row["id"]: _nearest_node(tuple(row["location"]["coordinates"]), nodes) for row in settlements}
    start = snaps[BASE_SETTLEMENT]
    routes: dict[str, dict[str, Any]] = {asset: {} for asset in ASSET_FACTOR}
    for asset in ASSET_FACTOR:
        distances, previous = _dijkstra(graph, start, asset)
        for settlement in settlements:
            sid = settlement["id"]; end = snaps[sid]
            if end not in distances:
                end = _nearest_node(tuple(settlement["location"]["coordinates"]), {node: nodes[node] for node in distances})
            path = _reconstruct(previous, start, end)
            if sid == BASE_SETTLEMENT: path = []
            if sid != BASE_SETTLEMENT and not path: continue
            node_path = [start] if not path else [path[0][0], *[edge[1] for edge in path]]
            coordinates = [[round(nodes[node][0], 6), round(nodes[node][1], 6)] for node in node_path]
            segments = []
            for left, right, way_id, tags, length in path:
                midpoint = ((nodes[left][0] + nodes[right][0]) / 2, (nodes[left][1] + nodes[right][1]) / 2)
                nearby = min(settlements, key=lambda row: _haversine(midpoint, tuple(row["location"]["coordinates"])))
                base_passability = 0.97
                if tags.get("surface") in {"unpaved", "gravel", "dirt", "ground", "mud", "sand"}: base_passability -= 0.08
                if tags.get("bridge") not in {None, "no"}: base_passability -= 0.04
                if tags.get("ford") not in {None, "no"}: base_passability -= 0.18
                segments.append({"way_id": way_id, "length_m": round(length, 1), "settlement_id": nearby["id"], "highway": tags.get("highway", "road"), "surface": tags.get("surface", "unknown"), "bridge": tags.get("bridge") not in {None, "no"}, "ford": tags.get("ford") not in {None, "no"}, "base_passability": round(base_passability, 3)})
            route_id = f"osm-{asset}-{BASE_SETTLEMENT}-{sid}"
            routes[asset][sid] = {"id": route_id, "origin_settlement_id": BASE_SETTLEMENT, "destination_settlement_id": sid, "asset_kind": asset, "road_node": end, "snap_distance_m": round(_haversine(nodes[end], tuple(settlement["location"]["coordinates"])), 1), "eta_minutes_normal": round(distances.get(end, 0), 1), "distance_km": round(sum(edge[4] for edge in path) / 1000, 2), "geometry": {"type": "LineString", "coordinates": coordinates}, "segments": segments, "attribution": "© OpenStreetMap contributors, ODbL 1.0"}
    DERIVED.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    output = DERIVED / "wayanad_routes.json"
    encoded = json.dumps({"schema_version": 1, "source": {"id": "osm-wayanad-roads-2026-08-29", "sha256": source_hash, "snapshot_at": payload["osm3s"]["timestamp_osm_base"], "license": "ODbL 1.0", "attribution": "© OpenStreetMap contributors"}, "base": {"settlement_id": BASE_SETTLEMENT, "road_node": start}, "counts": {"nodes": len(nodes), "ways": len(ways), "segments": segment_count}, "settlement_snaps": snaps, "routes": routes}, ensure_ascii=False, separators=(",", ":"))
    output.write_text(encoded, encoding="utf-8")
    with gzip.open(DERIVED / "wayanad_routes.json.gz", "wt", encoding="utf-8", compresslevel=9) as handle:
        handle.write(encoded)
    with gzip.open(DERIVED / "wayanad_road_graph.json.gz", "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump({"source_sha256": source_hash, "nodes": {str(key): value for key, value in nodes.items()}, "ways": ways}, handle, ensure_ascii=False, separators=(",", ":"))
    return output


if __name__ == "__main__":
    path = build(); print(json.dumps({"ok": True, "routes": str(path), "bytes": path.stat().st_size}))
