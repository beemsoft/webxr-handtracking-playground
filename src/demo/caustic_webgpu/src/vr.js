import * as THREE from "../vendor/three/build/three.webgpu.js";
import { fog, positionView, uniform } from "../vendor/three/build/three.tsl.js";
import {
  floorHeight,
  COLUMNS,
  PLINTH_RADIUS,
  PLINTH_TOP,
  ROOM_RADIUS,
} from "./original/architecture.js";
import { WATER_HEIGHT } from "./original/motion.js";

// Where the viewer stands when a session starts: in front of the columns, facing the dais, below the surface.
const START_HEAD = new THREE.Vector3(0, 2.6, 7.4);
const EYE_HEIGHT = 1.6;
const WALK_SPEED = 2.2;
const SWIM_SPEED = 1.4;
const DEAD_ZONE = 0.15;

/**
 * WebXR for the WebGPU renderer. It needs the browser's WebXR/WebGPU binding (`XRGPUBinding`), which only
 * some browsers ship; where it is missing the button stays hidden and the page explains why. There is no WebGL
 * fallback because the original's photon grid is a compute shader: use the WebGL "caustic" demo there.
 *
 * Three's render pipeline cannot present through an XR layer, so inside a session the scene is drawn directly
 * (the same TSL materials, with simple in-scene fog instead of the post-processing stack).
 */
export function createVR({ renderer, scene, camera, optics, settings, ripple, togglePause }) {
  const rig = new THREE.Group();
  rig.name = "XR rig";
  const headCamera = new THREE.PerspectiveCamera(100, 1, camera.near, camera.far);
  const head = { local: new THREE.Vector3(), world: new THREE.Vector3() };
  const savedCamera = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 58 };
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const fogColor = uniform(new THREE.Color(settings.fogColor));
  const fogStart = uniform(settings.fogStart);
  const fogHaze = uniform(settings.haze);
  // Same exponential-squared falloff as the post-processing composite, applied per material instead.
  const fogNode = fog(
    fogColor,
    positionView.length().sub(fogStart).max(0).mul(fogHaze).mul(0.06).pow(2).negate().exp().oneMinus(),
  );
  let active = false;
  let session = null;
  let button = null;

  renderer.xr.setReferenceSpaceType("local-floor");

  for (let index = 0; index < 2; index++) {
    const controller = renderer.xr.getController(index);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]),
      new THREE.LineBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.55, fog: false }),
    );
    line.frustumCulled = false;
    controller.add(line);
    controller.addEventListener("selectstart", () => rippleFrom(controller));
    controller.addEventListener("squeezestart", togglePause);
    rig.add(controller);
  }

  /** Ripple where the controller's ray meets the water surface. */
  function rippleFrom(controller) {
    controller.updateWorldMatrix(true, false);
    controller.getWorldPosition(origin);
    controller.getWorldQuaternion(quaternion);
    direction.set(0, 0, -1).applyQuaternion(quaternion);
    let t = 5;
    if (Math.abs(direction.y) > 0.05) {
      const hit = (WATER_HEIGHT - origin.y) / direction.y;
      if (hit > 0) t = hit;
    }
    origin.addScaledVector(direction, THREE.MathUtils.clamp(t, 0, 14));
    ripple(THREE.MathUtils.clamp(origin.x, -7, 7), THREE.MathUtils.clamp(origin.z, -7, 7));
  }

  /** Keep a head position out of the stone, the sphere and the wall, and under the surface. */
  function constrain(p) {
    const radius = Math.hypot(p.x, p.z);
    if (radius > ROOM_RADIUS + 2.5) {
      const scale = (ROOM_RADIUS + 2.5) / radius;
      p.x *= scale;
      p.z *= scale;
    }
    for (const column of COLUMNS) {
      const dx = p.x - column.x;
      const dz = p.z - column.z;
      const distance = Math.hypot(dx, dz);
      const clearance = column.radius * 1.3 + 0.28;
      if (distance < clearance) {
        p.x = column.x + (distance > 0.001 ? dx / distance : 1) * clearance;
        p.z = column.z + (distance > 0.001 ? dz / distance : 0) * clearance;
      }
    }
    delta.subVectors(p, optics.center.value);
    const orbClearance = optics.radius.value + 0.3;
    if (delta.length() < orbClearance) {
      p.copy(optics.center.value).addScaledVector(delta.normalize(), orbClearance);
    }
    const r = Math.hypot(p.x, p.z);
    const floor = r < PLINTH_RADIUS + 0.25 ? PLINTH_TOP : floorHeight(r);
    p.y = THREE.MathUtils.clamp(p.y, floor + 0.45, WATER_HEIGHT - 0.35);
  }

  function onSessionStart() {
    active = true;
    session = renderer.xr.getSession();
    savedCamera.position.copy(camera.position);
    savedCamera.quaternion.copy(camera.quaternion);
    savedCamera.fov = camera.fov;
    rig.position.set(START_HEAD.x, START_HEAD.y - EYE_HEIGHT, START_HEAD.z);
    scene.add(rig);
    rig.add(camera);
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    scene.fogNode = fogNode;
    if (button) button.textContent = "EXIT VR";
  }

  function onSessionEnd() {
    active = false;
    session = null;
    scene.fogNode = null;
    rig.remove(camera);
    scene.remove(rig);
    camera.position.copy(savedCamera.position);
    camera.quaternion.copy(savedCamera.quaternion);
    camera.fov = savedCamera.fov;
    camera.updateProjectionMatrix();
    if (button) button.textContent = "ENTER VR";
  }

  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);

  async function requestSession() {
    const next = await navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["webgpu"],
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
    });
    await renderer.xr.setSession(next);
  }

  /** Whether this browser can run an immersive session on the WebGPU backend. */
  async function isSupported() {
    if (!navigator.xr || !("XRGPUBinding" in globalThis)) return false;
    try {
      return await navigator.xr.isSessionSupported("immersive-vr");
    } catch {
      return false;
    }
  }

  /** Builds the toolbar button, or the explanation shown when WebGPU XR is unavailable. */
  async function createControls(slot) {
    if (!(await isSupported())) {
      const note = document.createElement("span");
      note.id = "vr-note";
      note.innerHTML =
        'VR needs a browser with WebXR + WebGPU (not available here). Use <a href="../caustic/index.html">Caustic (WebGL)</a> in the headset.';
      slot.replaceChildren(note);
      return null;
    }
    button = document.createElement("button");
    button.type = "button";
    button.textContent = "ENTER VR";
    button.addEventListener("click", async () => {
      if (session) {
        session.end();
        return;
      }
      try {
        await requestSession();
      } catch (error) {
        console.error("Could not start the WebGPU XR session:", error);
        button.textContent = "VR FAILED";
      }
    });
    slot.replaceChildren(button);
    return button;
  }

  /** Per XR frame: read the head pose, walk with the sticks, and keep the viewer inside the room. */
  function update(dt, frame) {
    if (!active) return;
    const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
    if (pose) {
      const p = pose.transform.position;
      const o = pose.transform.orientation;
      head.local.set(p.x, p.y, p.z);
      quaternion.set(o.x, o.y, o.z, o.w);
      forward.set(0, 0, -1).applyQuaternion(quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      right.crossVectors(forward, up);
      move.set(0, 0, 0);
      let vertical = 0;
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes;
        if (!axes) continue;
        const x = axes.length > 2 ? axes[2] : axes[0];
        const y = axes.length > 3 ? axes[3] : axes[1];
        if (source.handedness === "right") {
          if (Math.abs(y) > DEAD_ZONE) vertical -= y * SWIM_SPEED;
        } else {
          if (Math.abs(x) > DEAD_ZONE) move.addScaledVector(right, x);
          if (Math.abs(y) > DEAD_ZONE) move.addScaledVector(forward, -y);
        }
      }
      if (move.lengthSq() > 1) move.normalize();
      rig.position.addScaledVector(move, WALK_SPEED * dt);
      rig.position.y += vertical * dt;
      head.world.copy(rig.position).add(head.local);
      origin.copy(head.world);
      constrain(head.world);
      rig.position.add(head.world.sub(origin));
      head.world.copy(rig.position).add(head.local);
      // Mirror-camera source for the planar water reflection (the XR cameras only exist inside the render).
      headCamera.aspect = camera.aspect;
      headCamera.near = camera.near;
      headCamera.far = camera.far;
      headCamera.updateProjectionMatrix();
      headCamera.position.copy(head.world);
      headCamera.quaternion.copy(quaternion);
      headCamera.updateMatrixWorld();
    }
    fogColor.value.set(settings.fogColor);
    fogStart.value = settings.fogStart;
    fogHaze.value = settings.haze;
  }

  return {
    createControls,
    update,
    get active() {
      return active;
    },
    /** Camera the offscreen passes (water mirror) should use. */
    get view() {
      return active ? headCamera : camera;
    },
    get headHeight() {
      return active ? head.world.y : camera.position.y;
    },
    dispose() {
      renderer.xr.removeEventListener("sessionstart", onSessionStart);
      renderer.xr.removeEventListener("sessionend", onSessionEnd);
      if (session) session.end();
    },
  };
}
