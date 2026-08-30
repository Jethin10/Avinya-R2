/**
 * Turning degrees into scene units, once, so every layer lands on the same ground.
 *
 * Terrain, village polygons, roads and thirty thousand building footprints arrive from four
 * different Forge steps in WGS84 degrees. They only line up if all of them go through the same
 * projection, so a scene builds one ``Projector`` from its own bounding box and everything is
 * placed through it - a second, subtly different, projection would show buildings drifting off
 * their village by a hundred metres and there would be nothing on screen to say why.
 *
 * The projection is a local equirectangular one: at a district's scale (tens of kilometres) the
 * error against a proper conformal projection is far below the resolution of any of this data, and
 * it has the property that matters here - it is cheap, invertible, and exactly the same arithmetic
 * on both the CPU here and in any shader that has to undo it.
 */

const METRES_PER_DEGREE_LAT = 110574;
const EQUATORIAL_METRES_PER_DEGREE = 111320;

/**
 * A projection from degrees to a metres-like plane centred on ``centre``, scaled so the longest
 * side of ``bbox`` spans ``span`` scene units.
 *
 * X runs east, Z runs *south* - Three.js is right-handed with Y up, so a north-up map has to put
 * north at -Z. Getting that backwards mirrors the district, which is the kind of error that looks
 * like a rendering bug for an hour before it turns out to be a sign.
 */
export function projector(bbox, span = 100) {
  const [west, south, east, north] = bbox;
  const centre = [(west + east) / 2, (south + north) / 2];
  const metresPerLon = EQUATORIAL_METRES_PER_DEGREE * Math.cos((centre[1] * Math.PI) / 180);
  const width = (east - west) * metresPerLon;
  const depth = (north - south) * METRES_PER_DEGREE_LAT;
  const scale = span / Math.max(width, depth);
  return {
    bbox,
    centre,
    scale,
    /** Scene units per metre - what vertical exaggeration and building heights are measured in. */
    unitsPerMetre: scale,
    width: width * scale,
    depth: depth * scale,
    project(lon, lat) {
      return [
        (lon - centre[0]) * metresPerLon * scale,
        -(lat - centre[1]) * METRES_PER_DEGREE_LAT * scale,
      ];
    },
    unproject(x, z) {
      return [
        centre[0] + x / (metresPerLon * scale),
        centre[1] - z / (METRES_PER_DEGREE_LAT * scale),
      ];
    },
  };
}

/** Metres between two lon/lat points, for route lengths and epicentre distances. */
export function metresBetween([lon1, lat1], [lon2, lat2]) {
  const east = (lon2 - lon1) * EQUATORIAL_METRES_PER_DEGREE
    * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  const north = (lat2 - lat1) * METRES_PER_DEGREE_LAT;
  return Math.hypot(east, north);
}

/** Bounding box of a list of rings, as ``[west, south, east, north]``. */
export function bboxOf(rings) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < box[0]) box[0] = lon;
      if (lat < box[1]) box[1] = lat;
      if (lon > box[2]) box[2] = lon;
      if (lat > box[3]) box[3] = lat;
    }
  }
  return box;
}

export function unionBbox(boxes) {
  return boxes.reduce((into, box) => [
    Math.min(into[0], box[0]), Math.min(into[1], box[1]),
    Math.max(into[2], box[2]), Math.max(into[3], box[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

/**
 * Every ring of a GeoJSON geometry, flattened, outer and holes alike.
 *
 * Village boundaries in the packages are a mix of Polygon and MultiPolygon; the map only ever
 * needs their outlines, so the distinction is collapsed here rather than at four call sites.
 */
export function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/** Signed area of a projected ring, in scene units. Negative means clockwise in this frame. */
export function signedArea(points) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    total += x1 * z2 - x2 * z1;
  }
  return total / 2;
}

/** Centroid of a projected ring, falling back to the mean vertex for degenerate slivers. */
export function centroidOf(points) {
  const area = signedArea(points);
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce((into, [x, z]) => [into[0] + x, into[1] + z], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
  }
  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    const cross = x1 * z2 - x2 * z1;
    x += (x1 + x2) * cross;
    z += (z1 + z2) * cross;
  }
  return [x / (6 * area), z / (6 * area)];
}

/**
 * A camera-safe point guaranteed to be inside a normal district polygon.
 *
 * The mathematical centroid of a concave polygon is allowed to sit outside the polygon. That is a
 * perfectly valid centroid and a terrible camera target: several Kerala districts are concave
 * enough that clicking them used to fly the camera into a neighbouring district or empty space.
 * Prefer the centroid when it is actually inside; otherwise sample the polygon's bounding box and
 * choose the interior point with the most clearance from an edge. This is a small, deterministic
 * polylabel-style search and runs only once when a state scene is built.
 */
export function interiorPoint(points) {
  if (!points?.length) return [0, 0];
  const centroid = centroidOf(points);
  if (pointInRing(centroid, points)) return centroid;

  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of points) {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  }
  const centre = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  if (pointInRing(centre, points)) return centre;

  const segmentDistanceSquared = ([px, pz], [ax, az], [bx, bz]) => {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared))
      : 0;
    const x = ax + dx * t;
    const z = az + dz * t;
    return (px - x) ** 2 + (pz - z) ** 2;
  };

  let best = null;
  let bestClearance = -1;
  const divisions = 28;
  for (let row = 0; row < divisions; row += 1) {
    for (let column = 0; column < divisions; column += 1) {
      const candidate = [
        minX + ((column + 0.5) / divisions) * (maxX - minX),
        minZ + ((row + 0.5) / divisions) * (maxZ - minZ),
      ];
      if (!pointInRing(candidate, points)) continue;
      let clearance = Infinity;
      for (let index = 0; index < points.length; index += 1) {
        clearance = Math.min(clearance, segmentDistanceSquared(
          candidate,
          points[index],
          points[(index + 1) % points.length],
        ));
      }
      if (clearance > bestClearance) {
        best = candidate;
        bestClearance = clearance;
      }
    }
  }
  return best || centroid;
}

/** Is a projected point inside a projected ring? Ray casting; used for click hit-testing. */
export function pointInRing([x, z], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, zi] = ring[index];
    const [xj, zj] = ring[previous];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Drop vertices that carry no shape, cheaply.
 *
 * OSM footprints and archived boundaries are digitised at a resolution far finer than a district
 * shown on a laptop screen, and thirty thousand footprints at full fidelity is a geometry the
 * browser spends longer building than rendering. Perpendicular-distance decimation on a ring is
 * enough: it keeps corners, which is all a building silhouette is.
 */
export function simplify(points, tolerance) {
  if (points.length < 4 || !tolerance) return points;
  const kept = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const [ax, az] = kept[kept.length - 1];
    const [bx, bz] = points[index];
    const [cx, cz] = points[index + 1];
    const length = Math.hypot(cx - ax, cz - az);
    const distance = length < 1e-12
      ? Math.hypot(bx - ax, bz - az)
      : Math.abs((cx - ax) * (az - bz) - (ax - bx) * (cz - az)) / length;
    if (distance > tolerance) kept.push(points[index]);
  }
  kept.push(points[points.length - 1]);
  return kept.length >= 4 ? kept : points;
}
