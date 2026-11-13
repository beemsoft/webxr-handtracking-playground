import * as THREE from "../../vendor/three/build/three.webgpu.js";
import { WATER_HEIGHT } from "./motion.js";
import {
  floorHeight,
  COLUMNS,
  PLINTH_RADIUS,
  PLINTH_TOP,
  ROOM_RADIUS,
} from "./architecture.js";

const VIEWS = [
  {
    name: "Observatory",
    position: [0, 2.9, 12],
    target: [0, 2.65, 0],
    fov: 48,
  },
  { name: "Amber school", school: 0, outward: -2.3, behind: 2.5, fov: 58 },
  { name: "Azure school", school: 1, outward: -2.5, behind: -1.6, fov: 58 },
  { name: "Green school", school: 2, outward: -2.3, behind: 2.5, fov: 58 },
  { name: "Yellow school", school: 3, outward: -2.5, behind: -1.6, fov: 58 },
  {
    name: "Across the dais",
    position: [4.7, 1.6, 3.3],
    target: [0, 2, 0],
    fov: 62,
  },
  {
    name: "Through the columns",
    position: [-4.2, 1.65, 7.6],
    target: [0.15, 2.95, 0],
    fov: 46,
  },
  {
    name: "Terrace overlook",
    position: [-4.8, 3.2, -4.8],
    target: [0, 2.15, 0],
    fov: 56,
  },
];

export function createCameraViews(camera, controls, marine, optics, onCut) {
  const state = { view: VIEWS[0].name };
  let index = 0,
    following = false,
    fieldOfView = VIEWS[0].fov;
  const radial = new THREE.Vector3(),
    heading = new THREE.Vector3(),
    delta = new THREE.Vector3();
  const columns = COLUMNS;
  function resize() {
    camera.fov = THREE.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2)) *
            Math.max(1, 0.85 / camera.aspect),
        ),
    );
    camera.updateProjectionMatrix();
  }
  function constrain() {
    const p = camera.position;
    const radius = Math.hypot(p.x, p.z);
    if (radius > ROOM_RADIUS + 2.5) {
      const scale = (ROOM_RADIUS + 2.5) / radius;
      p.x *= scale;
      p.z *= scale;
    }
    for (const column of columns) {
      const dx = p.x - column.x,
        dz = p.z - column.z;
      const distance = Math.hypot(dx, dz),
        clearance = column.radius * 1.3 + 0.28;
      if (distance < clearance) {
        p.x = column.x + (distance > 0.001 ? dx / distance : 1) * clearance;
        p.z = column.z + (distance > 0.001 ? dz / distance : 0) * clearance;
      }
    }
    delta.subVectors(p, optics.center.value);
    const clearance = optics.radius.value + 0.3;
    if (delta.length() < clearance)
      p.copy(optics.center.value).addScaledVector(delta.normalize(), clearance);
    const r = Math.hypot(p.x, p.z);
    const floor = r < PLINTH_RADIUS + 0.25 ? PLINTH_TOP : floorHeight(r);
    p.y = THREE.MathUtils.clamp(p.y, floor + 0.45, WATER_HEIGHT - 0.35);
  }
  function update() {
    if (following) {
      const view = VIEWS[index],
        school = marine.schools[view.school];
      radial.copy(school.position).setY(0).normalize();
      heading.copy(school.direction).setY(0).normalize();
      camera.position
        .copy(school.position)
        .addScaledVector(radial, view.outward)
        .addScaledVector(heading, -view.behind);
      camera.position.y += 0.35;
      controls.target.copy(school.position).addScaledVector(heading, 0.35);
    }
    constrain();
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }
  function select(name) {
    if (name === "Free orbit") {
      release();
      return;
    }
    const next = VIEWS.findIndex((v) => v.name === name);
    if (next < 0) throw new RangeError(`Unknown view: ${name}`);
    // Drain OrbitControls' old drag momentum before placing the new camera.
    const damping = controls.enableDamping;
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update();
    index = next;
    state.view = name;
    const view = VIEWS[index];
    following = view.school !== undefined;
    fieldOfView = view.fov;
    controls.minDistance = following ? 1.4 : 3;
    controls.maxDistance = following ? 7 : ROOM_RADIUS + 2.5;
    controls.minPolarAngle = Math.PI * 0.24;
    controls.maxPolarAngle = Math.PI * 0.64;
    if (!following) {
      camera.position.fromArray(view.position);
      controls.target.fromArray(view.target);
    }
    resize();
    update();
    controls.update();
    controls.enableDamping = damping;
    onCut();
  }
  function release() {
    following = false;
    state.view = "Free orbit";
  }
  return {
    state,
    names: [...VIEWS.map((v) => v.name), "Free orbit"],
    get index() {
      return index;
    },
    get following() {
      return following;
    },
    select,
    release,
    resize,
    update,
    next() {
      select(VIEWS[(index + 1) % VIEWS.length].name);
    },
    reset() {
      select(VIEWS[0].name);
    },
  };
}
