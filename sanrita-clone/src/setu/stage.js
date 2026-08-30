/**
 * The one WebGL context the SETU layer owns.
 *
 * A renderer, a camera, a rig, an environment map, and a slot for whichever scene is current. It is
 * a single context on purpose: the clone already runs its own for the landing terrain, and a third
 * would mean three GPU contexts competing on a laptop that is also running a Python engine.
 *
 * The look is not invented here. Tone mapping, exposure, fog colour and the environment map are the
 * clone's own - the same ``environment.hdr`` the site lights its GLB terrain with, at the same
 * exposure - so a district rendered by this file sits in the same light as the landing scene rather
 * than looking like a screenshot from a different application pasted in.
 */

import * as THREE from "three";
import { palette, rgb } from "./palette.js";
import { createRig } from "./camera.js";

export function createStage(host) {
  // The captured site already owns the page background. Keep this canvas transparent so opening a
  // state feels like the existing map gaining another layer, not like SETU replacing the website
  // with a second themed application. A modest DPR cap is deliberate too: on a 2x/3x laptop panel
  // the old renderer was pushing 4-9x as many fragments for detail that is invisible at state scale.
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const atmosphere = new THREE.Color(...rgb(palette.icyBlue));
  scene.background = null;
  // Fade distant geometry into the site's pale canvas. The canvas itself remains transparent.
  scene.fog = new THREE.Fog(atmosphere, 220, 1400);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 5000);
  // The camera can ask the stage for a frame without owning the render loop. During construction
  // this is intentionally a no-op; the real invalidator is installed once the scheduler exists.
  let invalidate = () => {};
  const requestStageRender = (duration = 0) => invalidate(duration);
  const rig = createRig(camera, renderer.domElement, requestStageRender);

  // SETU deliberately avoids the clone's HDR/PMREM pass. That pass is attractive on the hero GLB,
  // but on an operational relief map it adds a second large texture upload + convolution step while
  // the site's own WebGL scene is already resident. Two cheap lights preserve the same soft relief
  // read without the startup hitch or the extra GPU memory pressure.
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(-160, 260, 190);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(
    new THREE.Color(...rgb(palette.icyBlue)), new THREE.Color(...rgb(palette.deepGreen)), 0.72));

  const resize = () => {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestStageRender();
  };
  resize();
  window.addEventListener("resize", resize);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  let current = null;
  let frame = null;
  let last = performance.now();
  let lastPaint = 0;
  let keepAliveUntil = 0;
  let renderCount = 0;
  let dirty = true;
  const clock = { running: false };
  const FRAME_INTERVAL = 1000 / 30;

  // Publish only when the scheduler changes state, not on every frame. Besides being useful during
  // live demos and QA, this makes the performance contract observable without adding per-frame DOM
  // work that would undermine the optimization itself.
  const publishScheduler = (state) => {
    if (renderer.domElement.dataset.setuRenderState === state) return;
    renderer.domElement.dataset.setuRenderState = state;
    renderer.domElement.dataset.setuRenderCount = String(renderCount);
  };

  const schedule = () => {
    if (!clock.running || frame != null || document.hidden) return;
    publishScheduler("active");
    frame = requestAnimationFrame(loop);
  };

  invalidate = (duration = 0) => {
    dirty = true;
    if (duration > 0) keepAliveUntil = Math.max(keepAliveUntil, performance.now() + duration);
    schedule();
  };

  function loop(now) {
    frame = null;
    if (!clock.running || document.hidden) return;
    // Thirty stable frames are substantially better here than an unstable attempt at 60. More
    // importantly, there is no perpetual loop anymore: these frames only exist while something is
    // moving or has explicitly invalidated the stage.
    if (now - lastPaint < FRAME_INTERVAL) {
      schedule();
      return;
    }
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    const cameraChanged = rig.update(delta);
    const sceneAnimating = Boolean(current?.update?.(delta, now / 1000));
    const forcedAnimation = now < keepAliveUntil;

    if (dirty || cameraChanged || sceneAnimating || forcedAnimation) {
      renderer.render(scene, camera);
      renderCount += 1;
      lastPaint = now;
      dirty = false;
    }

    if (rig.active || sceneAnimating || forcedAnimation || dirty) schedule();
    else publishScheduler("idle");
  }

  const onVisibilityChange = () => {
    if (!document.hidden) invalidate();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const stage = {
    THREE,
    renderer,
    scene,
    camera,
    rig,
    host,

    /** Screen coordinates to a point on the ground plane, for hover and click hit-testing. */
    groundAt(event, height = 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      plane.constant = -height;
      return raycaster.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
    },

    /** World point back to screen coordinates, so a DOM label can track a village. */
    toScreen([x, y, z]) {
      const vector = new THREE.Vector3(x, y, z).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return [
        rect.left + ((vector.x + 1) / 2) * rect.width,
        rect.top + ((1 - vector.y) / 2) * rect.height,
        vector.z,
      ];
    },

    /**
     * Swap in a scene. The outgoing one is disposed rather than hidden - a district's buildings are
     * tens of megabytes of GPU buffers and keeping two districts resident to save a rebuild is how a
     * demo runs out of memory in front of an audience.
     */
    show(next) {
      if (current) {
        scene.remove(current.group);
        current.dispose?.();
        disposeTree(current.group);
      }
      current = next;
      if (next) scene.add(next.group);
      invalidate();
      return next;
    },

    get scene3d() { return current; },

    start() {
      if (clock.running) return;
      clock.running = true;
      last = performance.now();
      // Paint one frame immediately. Besides avoiding a black flash before the browser grants the
      // first animation frame, this keeps the scene visible when a backgrounded tab throttles rAF.
      rig.update(0);
      const sceneAnimating = Boolean(current?.update?.(0, last / 1000));
      renderer.render(scene, camera);
      renderCount += 1;
      lastPaint = last;
      dirty = false;
      if (rig.active || sceneAnimating || last < keepAliveUntil) schedule();
      else publishScheduler("idle");
    },

    /** Paint one fresh frame, then sleep again unless the camera or scene is still animating. */
    invalidate() {
      invalidate();
    },

    /** Keep painting briefly while a scene-owned rAF animation mutates geometry outside this loop. */
    wakeFor(duration) {
      invalidate(Math.max(0, duration || 0));
    },

    /** Small runtime probe used by QA/performance audits without opening Three internals manually. */
    stats() {
      return {
        renders: renderCount,
        scheduled: frame != null,
        cameraAnimating: rig.active,
        render: { ...renderer.info.render },
        memory: { ...renderer.info.memory },
      };
    },

    stop() {
      clock.running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      keepAliveUntil = 0;
      publishScheduler("stopped");
    },

    dispose() {
      stage.stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      rig.dispose();
      stage.show(null);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  return stage;
}

/** Free every geometry and material under a group. Three does not do this for you. */
export function disposeTree(root) {
  root?.traverse?.((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}
