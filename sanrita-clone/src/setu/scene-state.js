/**
 * A state, as its districts.
 *
 * Each district is extruded from its own archived boundary, and how far it stands up is its severity
 * - so the shape of the emergency is legible before a single number has been read. Hovering names a
 * district and its failure mode; clicking one commits to it and hands off to the district scene.
 *
 * Only some of these numbers are the engine's. Wayanad has a package behind it and its height is a
 * computed belief; every other district's is authored, and the interface says so both in the
 * disclosure line and by drawing them with an outline the live district does not have. Two visual
 * treatments for two provenances, because a legend that says "some of these are made up" without
 * saying *which* is not a disclosure.
 */

import * as THREE from "three";
import { palette, rgb } from "./palette.js";
import { bboxOf, centroidOf, interiorPoint, projector, ringsOf, simplify } from "./geo.js";

const SPAN = 200;
/** Low relief keeps severity readable without making the state look like stacked toy blocks. */
const RELIEF = 8.6;
const BASE = 1.0;

// State overview colours are intentionally cooler than the district hazard palette. On the site's
// pale background this reads as an integrated cartographic layer; warm orange is reserved for the
// genuinely severe end instead of tinting the whole screen green/grey.
const STATE_STOPS = [
  [0.0, "#7893a3"],
  [0.3, "#90a9b3"],
  [0.55, "#c0ac87"],
  [0.78, "#c9825d"],
  [1.0, "#b95c49"],
];

function stateSeverityColour(severity) {
  const value = Math.min(1, Math.max(0, severity || 0));
  for (let index = 1; index < STATE_STOPS.length; index += 1) {
    const [stop, colour] = STATE_STOPS[index];
    const [previousStop, previousColour] = STATE_STOPS[index - 1];
    if (value <= stop) {
      const t = (value - previousStop) / (stop - previousStop || 1);
      const from = rgb(previousColour);
      const to = rgb(colour);
      return from.map((channel, axis) => channel + (to[axis] - channel) * t);
    }
  }
  return rgb(STATE_STOPS[STATE_STOPS.length - 1][1]);
}

function stateTolerance(state) {
  const points = state.districts.reduce(
    (total, district) => total + district.rings.reduce((sum, ring) => sum + ring.length, 0),
    0,
  );
  if (points > 6500) return 0.28;
  if (points > 4000) return 0.2;
  if (points > 2200) return 0.14;
  return 0.1;
}

function shapeFrom(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();
  return shape;
}

/**
 * Build the state scene.
 *
 * ``severityFor(districtId)`` returns ``{severity, failure_mode, live, ...}`` for one district; the
 * caller owns the decision of where that came from, so this file never has to know whether it is
 * looking at an engine belief or a stand-in.
 */
export function buildStateScene({ state, severityFor, onPick, onHover }) {
  const group = new THREE.Group();
  const project = projector(state.bbox, SPAN);
  const districts = [];
  const tolerance = stateTolerance(state);
  const forest = new THREE.Color(...rgb(palette.forestGreen));
  const deepGreen = new THREE.Color(...rgb(palette.deepGreen));
  const signal = new THREE.Color(...rgb(palette.signalOrange));

  for (const district of state.districts) {
    const rings = district.rings.map((ring) => simplify(ring.map(([lon, lat]) => project.project(lon, lat)), tolerance));
    const outer = rings.reduce((longest, ring) => (ring.length > longest.length ? ring : longest), []);
    if (outer.length < 4) continue;
    const row = severityFor(district) || { severity: 0, live: false };
    const height = BASE + RELIEF * (row.severity || 0);

    const geometry = new THREE.ExtrudeGeometry(shapeFrom(outer), {
      depth: height,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelThickness: 0.34,
      bevelSize: 0.24,
      curveSegments: 2,
    });
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...stateSeverityColour(row.severity)),
      roughness: 0.86,
      metalness: 0.0,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = district.id;
    mesh.userData = { district, row, height, base: height };
    group.add(mesh);

    // Hairline outlines keep the relief crisp without turning the state into a wireframe model.
    // The one district backed by the live/baked engine gets the same restrained signal orange used
    // everywhere else in SETU instead of introducing a second, unrelated "Apple blue" accent.
    const edgeColor = row.live ? signal : deepGreen;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 28),
      new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: row.live ? 0.5 : 0.13,
      }),
    );
    edge.position.y = 0.01;
    group.add(edge);
    mesh.userData.edge = edge;

    const shapeCentroid = centroidOf(outer);
    const shapeAnchor = interiorPoint(outer);
    // ExtrudeGeometry is authored in XY and then rotated -90° around X to lie on the ground. That
    // rotation maps shape Y to world -Z. Camera targets and beacons live in world space, so carrying
    // the unrotated +Z value across here mirrors them to the other side of the state — the exact
    // reason some district clicks used to fly the camera into apparently random empty space.
    const centroid = [shapeCentroid[0], -shapeCentroid[1]];
    const anchor = [shapeAnchor[0], -shapeAnchor[1]];
    const xs = outer.map(([x]) => x);
    const zs = outer.map(([, z]) => z);
    const footprintSpan = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
    );

    // A low-profile live marker sits on the engine-backed district. Keep it close to the surface:
    // tall pins made the cartography feel game-like and visually detached from the San Rita shell.
    if (row.live) {
      const beaconGroup = new THREE.Group();
      const pinGeom = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 12);
      pinGeom.translate(0, 1.1, 0);
      const pinMat = new THREE.MeshBasicMaterial({ color: signal, transparent: true, opacity: 0.82 });
      const pinMesh = new THREE.Mesh(pinGeom, pinMat);

      const ringGeom = new THREE.RingGeometry(0.95, 1.22, 36);
      ringGeom.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: signal, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.position.y = 2.24;

      beaconGroup.add(pinMesh, ringMesh);
      beaconGroup.position.set(anchor[0], height, anchor[1]);
      group.add(beaconGroup);
    }

    districts.push({ mesh, district, row, centroid, anchor, footprintSpan, height });
  }

  // The ground plinth the districts sit on
  const stateRings = state.rings.map((ring) => simplify(ring.map(([lon, lat]) => project.project(lon, lat)), tolerance));
  const plinthGeom = new THREE.ExtrudeGeometry(
    shapeFrom(stateRings.reduce((a, b) => (b.length > a.length ? b : a), [])),
    { depth: 0.82, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.22, bevelSegments: 2, curveSegments: 2 },
  );
  plinthGeom.rotateX(-Math.PI / 2);
  const plinth = new THREE.Mesh(
    plinthGeom,
    new THREE.MeshStandardMaterial({ color: forest, roughness: 0.92, metalness: 0 }),
  );
  plinth.position.y = -0.9;
  group.add(plinth);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let hovered = null;
  const meshes = districts.map((entry) => entry.mesh);

  function pick(event, element, camera) {
    const rect = element.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const first = raycaster.intersectObjects(meshes, false)[0];
    return first ? districts.find((entry) => entry.mesh === first.object) : null;
  }

  function highlight(entry) {
    if (hovered === entry) return;
    if (hovered) hovered.mesh.material.emissive?.setRGB(0, 0, 0);
    hovered = entry;
    if (hovered) {
      hovered.mesh.material.emissive = new THREE.Color(...rgb(palette.signalOrange));
      hovered.mesh.material.emissiveIntensity = 0.22;
    }
    onHover?.(entry);
  }

  return {
    group,
    project,
    districts,
    span: SPAN,
    /** Where a camera should sit to see the whole state, in the rig's spherical terms. */
    overview: { azimuth: -Math.PI / 5, polar: 0.78, distance: SPAN * 1.35, target: [0, 0, 0] },

    /**
     * A deterministic shot for a district. `anchor` is guaranteed to be inside the district, unlike
     * a polygon centroid, and the distance follows the district's own footprint instead of using one
     * magic zoom value for both tiny coastal districts and large mountain districts.
     */
    focus(entry, { close = true } = {}) {
      if (!entry) return null;
      const distance = close
        ? Math.max(58, Math.min(112, entry.footprintSpan * 2.7))
        : Math.max(110, Math.min(this.overview.distance * 0.92, entry.footprintSpan * 4.2));
      return {
        target: [entry.anchor[0], entry.height * (close ? 1.15 : 0.55), entry.anchor[1]],
        distance,
        polar: close ? 0.58 : 0.72,
        azimuth: this.overview.azimuth,
      };
    },

    /**
     * Revise one district's severity after the fact.
     *
     * The extrusion's height is fixed at build time, so a number that arrives late is applied as a
     * vertical scale and a new colour rather than as new geometry - and it eases in, because a
     * district that snapped to a new height would read as a rendering glitch rather than as the
     * engine having answered.
     */
    setSeverity(districtId, severity, duration = 800) {
      const entry = districts.find((row) => row.district.id === districtId);
      if (!entry) return null;
      const target = (BASE + RELIEF * severity) / entry.height;
      const from = entry.mesh.scale.y;
      const colour = new THREE.Color(...stateSeverityColour(severity));
      const started = performance.now();
      const step = () => {
        const progress = Math.min(1, (performance.now() - started) / duration);
        const eased = 1 - (1 - progress) ** 3;
        entry.mesh.scale.y = from + (target - from) * eased;
        entry.mesh.material.color.lerpColors(entry.mesh.material.color, colour, eased * 0.3);
        if (progress < 1) requestAnimationFrame(step);
        else entry.mesh.material.color.copy(colour);
      };
      step();
      entry.row.severity = severity;
      return entry;
    },

    hover(event, element, camera) {
      highlight(pick(event, element, camera));
      return hovered;
    },

    click(event, element, camera) {
      const entry = pick(event, element, camera);
      if (entry) onPick?.(entry);
      return entry;
    },

    /**
     * The rise: the picked district stands up out of the state while the rest sink away.
     *
     * It is one gesture rather than a cut because the point being made is that this district is part
     * of the state it just came out of - a cut to a new scene would lose that, and losing it is how
     * a map stops being a map and becomes a series of slides.
     */
    riseTo(entry, duration = 900) {
      const started = performance.now();
      const from = districts.map((row) => row.mesh.scale.y);
      return new Promise((resolve) => {
        const step = () => {
          const progress = Math.min(1, (performance.now() - started) / duration);
          const eased = 1 - (1 - progress) ** 3;
          districts.forEach((row, index) => {
            const target = row === entry ? 2.6 : 0.35;
            row.mesh.scale.y = from[index] + (target - from[index]) * eased;
            row.mesh.material.opacity = 1;
            if (row !== entry) {
              row.mesh.material.transparent = true;
              row.mesh.material.opacity = 1 - 0.55 * eased;
            }
            if (row.mesh.userData.edge) row.mesh.userData.edge.visible = row === entry;
          });
          if (progress < 1) requestAnimationFrame(step);
          else resolve();
        };
        step();
      });
    },

    /** Reset the rise, for coming back up from a district to its state. */
    settle() {
      for (const row of districts) {
        row.mesh.scale.y = 1;
        row.mesh.material.opacity = 1;
        row.mesh.material.transparent = false;
        if (row.mesh.userData.edge) row.mesh.userData.edge.visible = true;
      }
    },

    update() {},
  };
}

/** The bounding box of a state's districts, for states whose own bbox is missing. */
export function stateBbox(state) {
  return state.bbox || bboxOf(state.districts.flatMap((district) => ringsOf({ type: "Polygon", coordinates: district.rings })));
}
