/**
 * A district, on the ground: terrain, villages, buildings, water, roads.
 *
 * This is the scene the whole layer exists to arrive at, and it is built from four Forge outputs
 * that have nothing in common except a coordinate system: a Copernicus elevation grid, archived
 * village boundaries, an OpenStreetMap footprint snapshot, and the engine's own per-village beliefs.
 * They are all placed through the one projector so they land on each other correctly.
 *
 * Two things here are deliberately not the pretty version of themselves:
 *
 *   - Flood is drawn from the heightmap's own *height above nearest drainage* rather than as a
 *     horizontal plane at a chosen altitude. A flat plane would put water half way up a ridge, which
 *     is wrong in a way that happens to look convincing - the worst kind of wrong for a tool whose
 *     claim is that it does not invent data. HAND is the field the Forge actually shipped for this.
 *   - A building's shading is tinted by the belief for the village it belongs to, never by its own
 *     invented fate. The engine reasons about settlements; a per-building probability would be a
 *     number no model produced.
 */

import * as THREE from "three";
import { palette, rgb, severityColour } from "./palette.js";
import { centroidOf, projector, ringsOf, simplify } from "./geo.js";

const SPAN = 220;
/** Vertical exaggeration. Real relief over 30 km is a bump; the terrain has to read as terrain. */
const RELIEF = 2.6;
/** Footprints below this area are a shed or a digitising artefact; drawing them costs more than it says. */
const MIN_FOOTPRINT_M2 = 30;
/** Display LOD only. The source package remains complete; this bounds the geometry we push to WebGL. */
const MAX_RENDERED_BUILDINGS = 12000;
/** A 289x248 DEM is excessive for a ~220-unit overview. Every second sample preserves the relief. */
const TERRAIN_STEP = 2;

/**
 * The terrain mesh.
 *
 * A plane subdivided to the grid's own resolution, displaced by the elevation samples. Every vertex
 * also carries its HAND value as an attribute, which is what lets water be painted exactly where the
 * data says water goes, in the shader, at whatever stage the scrubber is at, with no rebuild.
 */
function buildTerrain(heightmap, project) {
  const { width, height, elevation, hand, no_data: noData } = heightmap;
  const [west, south, east, north] = heightmap.bbox;
  const [x0, z0] = project.project(west, north);
  const [x1, z1] = project.project(east, south);
  const gridWidth = Math.ceil((width - 1) / TERRAIN_STEP) + 1;
  const gridHeight = Math.ceil((height - 1) / TERRAIN_STEP) + 1;
  const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0, gridWidth - 1, gridHeight - 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);

  const position = geometry.attributes.position;
  const handAttribute = new Float32Array(position.count);
  const metres = project.unitsPerMetre * RELIEF;
  let lowest = Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const row = Math.floor(index / gridWidth);
    const column = index % gridWidth;
    const sourceRow = Math.min(height - 1, row * TERRAIN_STEP);
    const sourceColumn = Math.min(width - 1, column * TERRAIN_STEP);
    const sourceIndex = sourceRow * width + sourceColumn;
    const raw = elevation[sourceIndex];
    const value = raw === noData ? 0 : raw;
    position.setY(index, value * metres);
    handAttribute[index] = hand[sourceIndex] === noData ? 9999 : hand[sourceIndex];
    if (value < lowest) lowest = value;
  }
  geometry.setAttribute("aHand", new THREE.BufferAttribute(handAttribute, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...rgb(palette.setuTerrain)),
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  attachFlood(material, { water: new THREE.Color(...rgb(palette.icyBlue)), strength: 1.0 });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.userData = { metres, lowest, sample: (lon, lat) => sampleElevation(heightmap, lon, lat) * metres };
  return mesh;
}

/** Bilinear elevation lookup, so anything placed on the terrain sits on it rather than through it. */
function sampleElevation(heightmap, lon, lat) {
  const { width, height, elevation, no_data: noData } = heightmap;
  const [west, south, east, north] = heightmap.bbox;
  const u = ((lon - west) / (east - west)) * (width - 1);
  const v = ((north - lat) / (north - south)) * (height - 1);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return 0;
  const column = Math.min(width - 2, Math.max(0, Math.floor(u)));
  const row = Math.min(height - 2, Math.max(0, Math.floor(v)));
  const fx = Math.min(1, Math.max(0, u - column));
  const fz = Math.min(1, Math.max(0, v - row));
  const at = (r, c) => {
    const value = elevation[r * width + c];
    return value === noData ? 0 : value;
  };
  const top = at(row, column) * (1 - fx) + at(row, column + 1) * fx;
  const bottom = at(row + 1, column) * (1 - fx) + at(row + 1, column + 1) * fx;
  return top * (1 - fz) + bottom * fz;
}

/**
 * Teach a standard material about flood stage.
 *
 * Patching the built-in shader rather than writing a custom one keeps the site's lighting: this
 * geometry is still lit by the same HDR, tone-mapped the same way, fogged the same way, and only the
 * base colour changes. A bespoke ShaderMaterial would have to reimplement all of that and would
 * drift from the clone's look the first time either side changed.
 */
function attachFlood(material, { water, strength = 1.0 }) {
  material.userData.uFloodStage = { value: 0 };
  material.userData.uWater = { value: water };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFloodStage = material.userData.uFloodStage;
    shader.uniforms.uWater = material.userData.uWater;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aHand;\nvarying float vHand;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHand = aHand;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uFloodStage;
uniform vec3 uWater;
varying float vHand;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
// Submerged where the stage exceeds this point's height above the nearest drainage. The half-metre
// ramp is the shoreline: a hard edge would claim a precision the 30 m grid does not have.
float submerged = smoothstep(uFloodStage, uFloodStage - 0.5, vHand) * ${strength.toFixed(2)};
diffuseColor.rgb = mix(diffuseColor.rgb, uWater, submerged * 0.82);`);
  };
  material.customProgramCacheKey = () => "setu-flood";
  return material;
}

/** Move every flood-aware material to a new stage, in metres of water above drainage. */
function setFloodStage(root, metres) {
  root.traverse((node) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material?.userData?.uFloodStage) material.userData.uFloodStage.value = metres;
    }
  });
}

/* --- buildings -------------------------------------------------------------------------------- */

/**
 * Thirty thousand footprints as one mesh.
 *
 * One mesh and not thirty thousand: a draw call each would put the frame rate in the single digits
 * long before the terrain was visible. Merged, the whole settlement is a single buffer the GPU walks
 * once, and the cost of that decision is that a building cannot be moved on its own - which is fine,
 * because nothing here ever moves one.
 *
 * Each vertex carries two extra numbers. ``aHand`` is the footprint's own height above nearest
 * drainage, so the flood shader wets the buildings the water actually reaches rather than everything
 * below an altitude. ``aBelief`` is the engine's probability for the *village* the building sits in,
 * rewritten in place whenever belief changes, which is what makes the settlement darken as the model
 * becomes convinced rather than only a row in a panel changing.
 */
function buildBuildings(buildings, project, terrain) {
  const rows = buildings.buildings || [];
  const eligible = rows.filter((row) => (row.area_m2 || 0) >= MIN_FOOTPRINT_M2);
  const stride = Math.max(1, eligible.length / MAX_RENDERED_BUILDINGS);
  const visibleRows = stride === 1
    ? eligible
    : Array.from({ length: MAX_RENDERED_BUILDINGS }, (_, index) => eligible[Math.floor(index * stride)]);
  const positions = [];
  const normals = [];
  const hands = [];
  const beliefs = [];
  const index = [];
  const contour = [];

  for (const row of visibleRows) {
    const ring = row.footprint;
    if (!ring || ring.length < 4) continue;
    const projected = simplify(ring.slice(0, -1).map(([lon, lat]) => project.project(lon, lat)), 0.004);
    if (projected.length < 3) continue;

    contour.length = 0;
    for (const [x, z] of projected) contour.push(new THREE.Vector2(x, z));
    let faces;
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      // A self-intersecting footprint is an OSM data question, not one this file can answer.
      continue;
    }
    if (!faces.length) continue;

    const ground = terrain.userData.sample(row.centroid[0], row.centroid[1]);
    const top = ground + (row.height_m || 3.2) * project.unitsPerMetre * RELIEF;
    const start = positions.length / 3;
    // ShapeUtils works in XY and its winding is the opposite way round once Y becomes -Z, so the
    // roof triangles are emitted reversed to keep their normals pointing at the sky.
    for (const [a, b, c] of faces) {
      for (const vertex of [contour[c], contour[b], contour[a]]) {
        positions.push(vertex.x, top, vertex.y);
        normals.push(0, 1, 0);
      }
    }
    const added = positions.length / 3 - start;
    for (let step = 0; step < added; step += 1) {
      hands.push(row.hand_m ?? 9999);
      beliefs.push(0);
    }
    index.push({ start, count: added, settlement_id: row.settlement_id, role: row.role, id: row.id });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("aHand", new THREE.BufferAttribute(new Float32Array(hands), 1));
  const belief = new THREE.BufferAttribute(new Float32Array(beliefs), 1);
  belief.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aBelief", belief);
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...rgb(palette.icyBlue)),
    roughness: 0.62,
    metalness: 0.04,
    flatShading: true,
  });
  attachFlood(material, { water: new THREE.Color(...rgb(palette.deepGreen)), strength: 1.0 });
  attachBelief(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "buildings";
  mesh.userData = {
    index,
    count: rows.length,
    rendered: index.length,
    /** Repaint the footprints of one village. Called whenever the engine's belief for it moves. */
    setBelief(severityBySettlement) {
      const attribute = geometry.getAttribute("aBelief");
      for (const entry of index) {
        const value = severityBySettlement.get(entry.settlement_id) ?? 0;
        for (let step = 0; step < entry.count; step += 1) attribute.array[entry.start + step] = value;
      }
      attribute.needsUpdate = true;
    },
  };
  return mesh;
}

/**
 * The second shader patch: belief, as heat on the roofs.
 *
 * Layered after the flood patch on purpose - a village can be both believed to be in trouble and
 * under water, and the water has to win visually, because it is the observation and the belief is
 * the inference.
 */
function attachBelief(material) {
  const base = material.onBeforeCompile;
  material.userData.uAlarm = { value: new THREE.Color(...rgb(palette.signalOrange)) };
  material.onBeforeCompile = (shader) => {
    base?.(shader);
    shader.uniforms.uAlarm = material.userData.uAlarm;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aBelief;\nvarying float vBelief;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBelief = aBelief;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uAlarm;\nvarying float vBelief;")
      .replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uAlarm, clamp(vBelief, 0.0, 1.0) * 0.55);`);
  };
  material.customProgramCacheKey = () => "setu-flood-belief";
  return material;
}

/* --- villages, routes, epicentre -------------------------------------------------------------- */

/**
 * Village boundaries, draped on the terrain and coloured by belief.
 *
 * Drawn as an outline plus a low translucent fill rather than an opaque patch, because a village is
 * a place the buildings and the terrain are already describing and a solid colour over it would hide
 * both. The outline follows the ground, sampled per vertex, so it creases over ridges instead of
 * floating across them.
 */
function buildVillages(settlements, project, terrain) {
  const group = new THREE.Group();
  group.name = "villages";
  const entries = [];
  const outlinePositions = [];
  const outlineAlpha = [];

  for (const settlement of settlements) {
    const rings = ringsOf(settlement.geometry);
    if (!rings.length) continue;
    const outer = rings.reduce((longest, ring) => (ring.length > longest.length ? ring : longest), []);
    const projected = simplify(outer.map(([lon, lat]) => project.project(lon, lat)), 0.02);
    if (projected.length < 3) continue;

    // Every village boundary used to be its own Line + material, which made 49 tiny draw calls for
    // geometry that is visually one layer. Emit line segments into one buffer instead. A per-vertex
    // alpha attribute preserves the belief-driven boundary intensity without splitting the batch.
    const outlineStart = outlineAlpha.length;
    for (let point = 1; point < outer.length; point += 1) {
      for (const [lon, lat] of [outer[point - 1], outer[point]]) {
        const [x, z] = project.project(lon, lat);
        outlinePositions.push(x, terrain.userData.sample(lon, lat) + 0.35, z);
        outlineAlpha.push(0.24);
      }
    }

    const [lon, lat] = settlement.location.coordinates;
    const [x, z] = project.project(lon, lat);
    const y = terrain.userData.sample(lon, lat);
    entries.push({
      settlement,
      at: [x, y, z],
      centroid: centroidOf(projected),
      outlineStart,
      outlineCount: outlineAlpha.length - outlineStart,
    });
  }

  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(outlinePositions), 3));
  const outlineOpacity = new THREE.BufferAttribute(new Float32Array(outlineAlpha), 1);
  outlineOpacity.setUsage(THREE.DynamicDrawUsage);
  outlineGeometry.setAttribute("aAlpha", outlineOpacity);
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(...rgb(palette.forestGreen)), transparent: true, opacity: 1,
  });
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aAlpha;\nvarying float vAlpha;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlpha = aAlpha;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vAlpha;");
  };
  outlineMaterial.customProgramCacheKey = () => "setu-village-outline-alpha";
  const outlines = new THREE.LineSegments(outlineGeometry, outlineMaterial);
  outlines.name = "village-outlines";
  group.add(outlines);

  // Village markers are two instanced layers rather than 49 individual meshes. Normal villages use
  // a filled disc; silence zones use a hollow ring. Toggling the instance scale moves a settlement
  // between the two batches while keeping its instance id stable for raycasting.
  const markerCount = entries.length;
  const activeDiscs = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1.18, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.74 }),
    markerCount,
  );
  activeDiscs.name = "village-signals";
  const silentRings = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.72, 1.18, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.48, side: THREE.DoubleSide }),
    markerCount,
  );
  silentRings.name = "village-silence";
  activeDiscs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  silentRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const transform = new THREE.Object3D();
  const markerColour = new THREE.Color();
  const hiddenScale = 0.0001;
  const setMarkerMatrix = (mesh, index, entry, scale) => {
    transform.position.set(entry.at[0], entry.at[1] + 0.5, entry.at[2]);
    transform.rotation.set(-Math.PI / 2, 0, 0);
    transform.scale.setScalar(scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  };

  markerColour.setRGB(...rgb(palette.setuTerrain));
  entries.forEach((entry, index) => {
    entry.markerIndex = index;
    setMarkerMatrix(activeDiscs, index, entry, 1);
    setMarkerMatrix(silentRings, index, entry, hiddenScale);
    activeDiscs.setColorAt(index, markerColour);
    silentRings.setColorAt(index, markerColour);
  });
  activeDiscs.instanceMatrix.needsUpdate = true;
  silentRings.instanceMatrix.needsUpdate = true;
  activeDiscs.instanceColor.needsUpdate = true;
  silentRings.instanceColor.needsUpdate = true;
  activeDiscs.computeBoundingSphere();
  silentRings.computeBoundingSphere();
  group.add(activeDiscs, silentRings);

  group.userData = {
    entries,
    markers: [activeDiscs, silentRings],
    /** Recolour every village to a new belief table, and hide the ones the engine is quiet about. */
    setBelief(severityBySettlement, silent = new Set()) {
      for (const entry of entries) {
        const severity = severityBySettlement.get(entry.settlement.id) ?? 0;
        const colour = severityColour(severity);
        const scale = 1 + 0.85 * severity;
        const isSilent = silent.has(entry.settlement.id);
        markerColour.setRGB(...colour);
        activeDiscs.setColorAt(entry.markerIndex, markerColour);
        silentRings.setColorAt(entry.markerIndex, markerColour);
        setMarkerMatrix(activeDiscs, entry.markerIndex, entry, isSilent ? hiddenScale : scale);
        setMarkerMatrix(silentRings, entry.markerIndex, entry, isSilent ? scale : hiddenScale);
        const alpha = 0.17 + 0.27 * severity;
        for (let vertex = entry.outlineStart; vertex < entry.outlineStart + entry.outlineCount; vertex += 1) {
          outlineOpacity.array[vertex] = alpha;
        }
      }
      activeDiscs.instanceMatrix.needsUpdate = true;
      silentRings.instanceMatrix.needsUpdate = true;
      activeDiscs.instanceColor.needsUpdate = true;
      silentRings.instanceColor.needsUpdate = true;
      outlineOpacity.needsUpdate = true;
    },
    /** Reframe the same settlements for the current command-story lens. */
    setMode({
      lens = "belief",
      fogMode = "setu",
      severityBySettlement = new Map(),
      silent = new Set(),
      messages = new Map(),
      dispatchIds = new Set(),
      verifyIds = new Set(),
      selectedId = null,
    } = {}) {
      const maxMessages = Math.max(1, ...messages.values());
      for (const entry of entries) {
        const id = entry.settlement.id;
        const severity = severityBySettlement.get(id) ?? 0;
        const isSilent = silent.has(id);
        let scale = 0.72;
        let colour = severityColour(severity);
        let outline = 0.12;
        let useRing = false;

        if (lens === "fog" && fogMode === "reports") {
          const volume = messages.get(id) ?? 0;
          const signal = Math.log1p(volume) / Math.log1p(maxMessages);
          scale = 0.58 + signal * 1.45;
          colour = rgb(palette.forestGreen);
          outline = 0.08 + signal * 0.28;
          useRing = isSilent || volume === 0;
        } else if (lens === "fog" || lens === "belief") {
          scale = 0.78 + severity * 1.15;
          outline = 0.14 + severity * 0.3;
          useRing = isSilent;
        } else if (lens === "response") {
          const active = dispatchIds.has(id);
          scale = active ? 1.1 + severity * 0.75 : 0.42;
          colour = active ? severityColour(Math.max(0.35, severity)) : rgb(palette.setuTerrain);
          outline = active ? 0.24 + severity * 0.22 : 0.055;
          useRing = isSilent && active;
        } else if (lens === "verify") {
          const active = verifyIds.has(id);
          scale = active ? 1.0 + severity * 0.72 : 0.34;
          colour = active ? severityColour(Math.max(0.45, severity)) : rgb(palette.setuTerrain);
          outline = active ? 0.3 : 0.045;
          useRing = active && isSilent;
        } else if (lens === "proof") {
          scale = 0.62 + severity * 0.5;
          outline = 0.09 + severity * 0.15;
          useRing = isSilent;
        }

        if (id === selectedId) scale *= 1.35;
        markerColour.setRGB(...colour);
        activeDiscs.setColorAt(entry.markerIndex, markerColour);
        silentRings.setColorAt(entry.markerIndex, markerColour);
        setMarkerMatrix(activeDiscs, entry.markerIndex, entry, useRing ? hiddenScale : scale);
        setMarkerMatrix(silentRings, entry.markerIndex, entry, useRing ? scale : hiddenScale);
        for (let vertex = entry.outlineStart; vertex < entry.outlineStart + entry.outlineCount; vertex += 1) {
          outlineOpacity.array[vertex] = outline;
        }
      }
      activeDiscs.instanceMatrix.needsUpdate = true;
      silentRings.instanceMatrix.needsUpdate = true;
      activeDiscs.instanceColor.needsUpdate = true;
      silentRings.instanceColor.needsUpdate = true;
      outlineOpacity.needsUpdate = true;
    },
  };
  return group;
}

/** The dispatch routes, as they were planned, along their real road geometry. */
function buildRoutes(routes, project, terrain) {
  const group = new THREE.Group();
  group.name = "routes";
  for (const route of Object.values(routes || {})) {
    const coordinates = route.geometry?.coordinates || [];
    if (coordinates.length < 2) continue;
    const points = [];
    for (const [lon, lat] of coordinates) {
      const [x, z] = project.project(lon, lat);
      points.push(x, terrain.userData.sample(lon, lat) + 0.8, z);
    }
    // Passability is the road's own condition, so the line carries it: a clear road is drawn in the
    // site's signal yellow, a cut one fades towards the ground it is buried under.
    const passability = route.passability ?? 1;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3)),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(...rgb(passability > 0.5 ? palette.forestGreen : palette.signalOrange)),
        transparent: true, opacity: 0.35 + 0.55 * passability,
      }),
    );
    line.name = route.route_id;
    line.userData = { route };
    group.add(line);
  }
  return group;
}

/** Dashed model-propagation leads. These are deliberately not styled like roads. */
function buildCascadeLeads(villages) {
  const group = new THREE.Group();
  group.name = "cascade-leads";
  group.visible = false;
  const byId = new Map(villages.userData.entries.map((entry) => [entry.settlement.id, entry]));

  group.userData.setData = (prePositions = {}) => {
    group.clear();
    for (const [targetId, lead] of Object.entries(prePositions || {})) {
      const from = byId.get(lead.source);
      const to = byId.get(targetId);
      if (!from || !to) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.at[0], from.at[1] + 1.6, from.at[2]),
        new THREE.Vector3(to.at[0], to.at[1] + 1.6, to.at[2]),
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineDashedMaterial({
          color: new THREE.Color(...rgb(palette.signalOrange)),
          transparent: true,
          opacity: 0.42,
          dashSize: 1.6,
          gapSize: 1.1,
        }),
      );
      line.computeLineDistances();
      line.userData = { source: lead.source, target: targetId, lead };
      group.add(line);
    }
  };
  return group;
}

/** Where an operator put an epicentre. Rings on the ground, not a sphere in the air. */
function buildEpicentre(project, terrain) {
  const group = new THREE.Group();
  group.name = "epicentre";
  group.visible = false;
  for (let ring = 0; ring < 3; ring += 1) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.5, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(...rgb(palette.signalOrange)),
        transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.phase = ring / 3;
    group.add(mesh);
  }
  group.userData = {
    /** Place the marker at a lon/lat and scale the rings to a radius in kilometres. */
    place(lon, lat, radiusKm = 20) {
      const [x, z] = project.project(lon, lat);
      group.position.set(x, terrain.userData.sample(lon, lat) + 1.2, z);
      group.userData.radius = radiusKm * 1000 * project.unitsPerMetre;
      group.visible = true;
    },
    clear() { group.visible = false; },
    radius: 20,
  };
  return group;
}

/* --- assembly --------------------------------------------------------------------------------- */

/**
 * Build the district scene from whatever layers the package actually shipped.
 *
 * Every layer is optional and the scene degrades one layer at a time: no buildings is a district
 * with terrain and villages, no heightmap is a flat district with villages on it. What it never does
 * is substitute - if the heightmap is missing, the terrain is flat and says so, rather than being
 * generated from noise that would look like relief and mean nothing.
 */
export function buildDistrictScene({ settlements, heightmap, buildings, routes, onHoverVillage }) {
  const group = new THREE.Group();
  const bbox = heightmap?.bbox || buildings?.bbox || [75.8, 11.4, 76.5, 12.0];
  const project = projector(bbox, SPAN);

  const terrain = heightmap
    ? buildTerrain(heightmap, project)
    : flatTerrain(project);
  group.add(terrain);

  const villages = buildVillages(settlements || [], project, terrain);
  group.add(villages);

  const footprints = buildings ? buildBuildings(buildings, project, terrain) : null;
  if (footprints) group.add(footprints);

  const roads = buildRoutes(routes, project, terrain);
  group.add(roads);

  const cascadeLeads = buildCascadeLeads(villages);
  group.add(cascadeLeads);

  const epicentre = buildEpicentre(project, terrain);
  group.add(epicentre);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const markers = villages.userData.markers;
  let hovered = null;
  let elapsed = 0;

  function pick(event, element, camera) {
    const rect = element.getBoundingClientRect();
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    // Villages are hit-tested against their discs and not their polygons: a click is aimed at a
    // marker the eye can see, and polygon hit-testing on the terrain would resolve to whichever
    // boundary happened to be on top where two villages meet.
    raycaster.params.Points = { threshold: 2 };
    const first = raycaster.intersectObjects(markers, false)[0];
    return first && Number.isInteger(first.instanceId)
      ? villages.userData.entries[first.instanceId]
      : null;
  }

  return {
    group,
    project,
    terrain,
    villages,
    buildings: footprints,
    routes: roads,
    cascadeLeads,
    epicentre,
    span: SPAN,
    /** The arrival shot: low, angled, close enough that buildings have size. */
    overview: { azimuth: -Math.PI / 3.2, polar: 0.42, distance: SPAN * 0.72, target: [0, 0, 0] },
    /** Straight down, for reading the map as a map rather than as a landscape. */
    plan: { azimuth: 0, polar: 1.45, distance: SPAN * 0.95, target: [0, 0, 0] },

    counts: {
      settlements: villages.userData.entries.length,
      buildings: footprints?.userData.count ?? 0,
      renderedBuildings: footprints?.userData.rendered ?? 0,
      routes: roads.children.length,
      terrain: heightmap ? `${heightmap.width}x${heightmap.height}` : "absent",
    },

    /** Water level, in metres above the nearest drainage. Zero is a dry district. */
    setFlood(metres) {
      setFloodStage(group, metres);
    },

    /** Push a fresh belief table through both the village markers and the building shading. */
    setBelief(severityBySettlement, silent) {
      villages.userData.setBelief(severityBySettlement, silent);
      footprints?.userData.setBelief(severityBySettlement);
    },

    /** One scene, five readings: markers, roofs, routes and cascade leads change emphasis together. */
    setLens(mode = {}) {
      villages.userData.setMode(mode);
      const showBeliefOnBuildings = mode.lens !== "fog" || mode.fogMode === "setu";
      footprints?.userData.setBelief(showBeliefOnBuildings ? mode.severityBySettlement : new Map());

      roads.visible = mode.lens === "response";
      roads.children.forEach((line) => {
        const selected = mode.activeRouteId && line.name === mode.activeRouteId;
        line.material.opacity = mode.activeRouteId ? (selected ? 0.95 : 0.1) : 0.58;
        line.material.linewidth = selected ? 2 : 1;
      });

      cascadeLeads.userData.setData(mode.prePositions || {});
      cascadeLeads.visible = mode.lens === "response" && cascadeLeads.children.length > 0;
    },

    /** Fly to one village: the same gesture the state scene uses to enter a district, one level in. */
    focus(settlementId) {
      const entry = villages.userData.entries.find((row) => row.settlement.id === settlementId);
      if (!entry) return null;
      return { target: entry.at, distance: 34, polar: 0.34, azimuth: -Math.PI / 3 };
    },

    focusBlock(block) {
      const blockEntries = villages.userData.entries.filter((entry) => entry.settlement.block === block);
      if (!blockEntries.length) return null;
      const target = blockEntries.reduce((sum, entry) => [
        sum[0] + entry.at[0], sum[1] + entry.at[1], sum[2] + entry.at[2],
      ], [0, 0, 0]).map((value) => value / blockEntries.length);
      const radius = blockEntries.reduce((max, entry) => Math.max(
        max,
        Math.hypot(entry.at[0] - target[0], entry.at[2] - target[2]),
      ), 0);
      return {
        target,
        distance: Math.max(36, Math.min(SPAN * 0.72, radius * 2.2)),
        polar: 0.7,
        azimuth: -Math.PI / 3.2,
      };
    },

    hover(event, element, camera) {
      const entry = pick(event, element, camera);
      if (entry !== hovered) {
        hovered = entry;
        onHoverVillage?.(entry);
      }
      return hovered;
    },

    click(event, element, camera) {
      return pick(event, element, camera);
    },

    lonLatAt(point) {
      return project.unproject(point[0], point[1]);
    },

    update(delta) {
      elapsed += delta;
      // The epicentre rings travel outward and restart, three of them out of phase, so the marker
      // reads as energy leaving a point rather than as a static bullseye.
      if (epicentre.visible) {
        const radius = epicentre.userData.radius || 20;
        epicentre.children.forEach((ring) => {
          const phase = (elapsed * 0.35 + ring.userData.phase) % 1;
          ring.scale.setScalar(0.05 + phase * radius);
          ring.material.opacity = 0.55 * (1 - phase);
        });
      }
      return epicentre.visible;
    },
  };
}

/** A district with no elevation grid: flat ground, honestly flat, at the right extent. */
function flatTerrain(project) {
  const geometry = new THREE.PlaneGeometry(project.width, project.depth, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.setAttribute("aHand", new THREE.BufferAttribute(new Float32Array([9999, 9999, 9999, 9999]), 1));
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...rgb(palette.setuTerrain)), roughness: 0.95, metalness: 0,
  });
  attachFlood(material, { water: new THREE.Color(...rgb(palette.icyBlue)) });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.userData = { metres: project.unitsPerMetre * RELIEF, lowest: 0, sample: () => 0 };
  return mesh;
}
