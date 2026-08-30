/**
 * The camera, moving the way the site moves.
 *
 * San Rita's whole feel is one easing curve - ``cubic-bezier(.16, 1, .3, 1)``, a fast departure and
 * a long settle - applied to everything that transitions. A map that flies with a different curve
 * reads as a different product bolted on, so every camera move here is that same curve, solved in
 * ``easeSanRita``, over a duration in the same range the site's own transitions use.
 *
 * The rig is deliberately not an orbit controller with inertia and damping. Two reasons: the scenes
 * are a guided sequence rather than a model viewer, and a free camera in a district would let the
 * viewer end up under the terrain looking at the back faces of thirty thousand buildings. Drag
 * orbits within a clamped band, wheel zooms within a clamped range, and everything else is a move
 * the interface asked for.
 */

import { easeSanRita } from "./palette.js";

const HALF_PI = Math.PI / 2;

export function createRig(camera, element, invalidate = () => {}) {
  const state = {
    /** Spherical coordinates around ``target``: azimuth, polar angle, distance. */
    azimuth: -Math.PI / 4,
    polar: 0.92,
    distance: 160,
    target: [0, 0, 0],
    minPolar: 0.18,
    maxPolar: HALF_PI - 0.05,
    minDistance: 12,
    maxDistance: 900,
  };

  let tween = null;
  let dragging = null;

  // Camera moves are promises because view transitions wait for them. Cancelling a tween by simply
  // dropping the object leaves that promise unresolved forever; a drag or wheel during a district
  // transition could therefore strand navigation halfway through. Always settle the old move.
  const cancelTween = () => {
    if (!tween) return;
    const done = tween.resolve;
    tween = null;
    done?.(false);
  };

  const apply = () => {
    const [tx, ty, tz] = state.target;
    const radius = Math.cos(state.polar) * state.distance;
    camera.position.set(
      tx + Math.sin(state.azimuth) * radius,
      ty + Math.sin(state.polar) * state.distance,
      tz + Math.cos(state.azimuth) * radius,
    );
    camera.lookAt(tx, ty, tz);
    invalidate();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    dragging = { x: event.clientX, y: event.clientY, moved: 0 };
    element.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    cancelTween();
    state.azimuth -= dx * 0.005;
    state.polar = Math.min(state.maxPolar, Math.max(state.minPolar, state.polar + dy * 0.004));
    apply();
  };

  const onPointerUp = (event) => {
    // A press that never moved is a click on the map, not a camera gesture; the scenes hit-test on
    // pointerup and need to know which of the two just happened.
    const wasClick = dragging && dragging.moved < 6;
    dragging = null;
    element.releasePointerCapture?.(event.pointerId);
    return wasClick;
  };

  const onWheel = (event) => {
    event.preventDefault();
    cancelTween();
    const factor = Math.exp(event.deltaY * 0.0012);
    state.distance = Math.min(state.maxDistance, Math.max(state.minDistance, state.distance * factor));
    apply();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("wheel", onWheel, { passive: false });

  const rig = {
    state,
    camera,
    apply,
    /** Was the gesture that just ended a click rather than a drag? Consumed by the scenes. */
    endPointer: onPointerUp,
    /** True only while a cinematic move genuinely needs another animation frame. */
    get active() { return Boolean(tween); },

    /** Snap, no animation. Used when a scene is built and the first frame must already be right. */
    place({ azimuth, polar, distance, target }) {
      if (azimuth != null) state.azimuth = azimuth;
      if (polar != null) state.polar = polar;
      if (distance != null) state.distance = distance;
      if (target) state.target = [...target];
      cancelTween();
      apply();
    },

    /**
     * The cinematic move: interpolate the spherical coordinates and the look-at target together.
     *
     * Interpolating spherical rather than Cartesian is what makes it read as a camera swinging
     * around a subject instead of sliding through space, which is the difference between "the
     * district rose and we came around to look at it" and "the viewport panned".
     */
    flyTo({ azimuth, polar, distance, target, duration = 1800 }) {
      cancelTween();
      const from = { azimuth: state.azimuth, polar: state.polar, distance: state.distance, target: [...state.target] };
      // Take the short way round: without this a move from -170 to +170 degrees spins the long way.
      let toAzimuth = azimuth ?? state.azimuth;
      while (toAzimuth - from.azimuth > Math.PI) toAzimuth -= Math.PI * 2;
      while (from.azimuth - toAzimuth > Math.PI) toAzimuth += Math.PI * 2;
      const to = {
        azimuth: toAzimuth,
        polar: polar ?? state.polar,
        distance: distance ?? state.distance,
        target: target ? [...target] : [...state.target],
      };
      return new Promise((resolve) => {
        tween = { from, to, duration, elapsed: 0, resolve };
        invalidate();
      });
    },

    /** Advance any move in flight. Returns whether the camera changed this frame. */
    update(delta) {
      if (tween) {
        tween.elapsed += delta * 1000;
        const progress = Math.min(1, tween.elapsed / tween.duration);
        const eased = easeSanRita(progress);
        const mix = (a, b) => a + (b - a) * eased;
        state.azimuth = mix(tween.from.azimuth, tween.to.azimuth);
        state.polar = mix(tween.from.polar, tween.to.polar);
        state.distance = mix(tween.from.distance, tween.to.distance);
        state.target = state.target.map((_, axis) => mix(tween.from.target[axis], tween.to.target[axis]));
        apply();
        if (progress >= 1) {
          const done = tween.resolve;
          tween = null;
          done?.(true);
        }
        return true;
      }
      return false;
    },

    dispose() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("wheel", onWheel);
    },
  };

  apply();
  return rig;
}
