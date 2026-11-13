import { Box3, Color, Material, Mesh, MeshStandardMaterial, Object3D, Texture, Vector2, Vector3 } from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { CausticField } from './CausticField';
import { createCausticMaterial } from './CausticMaterials';
import { COLUMNS, PLINTH_RADIUS } from './Rotunda';

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

/** Everything big and solid inside the water: the column ring and the central plinth. */
export const OBSTACLES: Obstacle[] = [...COLUMNS, { x: 0, z: 0, radius: PLINTH_RADIUS + 0.1 }];

/** Load a GLB that ships with the demo, trying the page-relative path first. */
export function loadModel(folder: string, file: string): Promise<GLTF> {
  const load = (base: string) => new GLTFLoader().setPath(base).loadAsync(file);
  return load(`assets/${folder}/`).catch(() => load(`/src/demo/caustic/assets/${folder}/`));
}

/** Replace every material below `root` with the caustic-lit Lambert equivalent (keeps map and normal map). */
export function applyCausticMaterials(root: Object3D, field: CausticField): Material[] {
  const created: Material[] = [];
  const convert = (source: Material): Material => {
    const standard = source as MeshStandardMaterial;
    const map: Texture | null = standard.map ?? null;
    const material = createCausticMaterial(field, {
      color: standard.color ? standard.color.clone() : new Color(1, 1, 1),
      map,
      normalMap: standard.normalMap ?? null,
      normalScale: new Vector2(1, 1),
      side: standard.side,
      emissive: new Color(0.17, 0.18, 0.19),
      emissiveMap: map,
    });
    source.dispose();
    created.push(material);
    return material;
  };
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    // Skinned bounds follow the bind pose, so never cull them.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
  return created;
}

/** World-space bounds of a freshly loaded model (call before it is added to anything). */
export function measure(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(root);
}

const lateral = new Vector2();
const tangent = new Vector2();

/**
 * Steering away from the obstacle circles ahead of a body at (px, pz) heading (hx, hz).
 * The result is added into `out` (x, z in a Vector2) and is stronger the more directly the body
 * is on a collision course.
 */
export function steerAround(
  px: number,
  pz: number,
  hx: number,
  hz: number,
  bodyRadius: number,
  lookahead: number,
  margin: number,
  out: Vector2
): Vector2 {
  const length = Math.hypot(hx, hz) || 1;
  const dx = hx / length;
  const dz = hz / length;
  for (const o of OBSTACLES) {
    const ox = o.x - px;
    const oz = o.z - pz;
    const along = ox * dx + oz * dz;
    const clearance = o.radius + bodyRadius + margin;
    if (along < -clearance * 0.5 || along > lookahead + clearance) continue;
    lateral.set(ox - dx * along, oz - dz * along);
    const distance = lateral.length();
    if (distance >= clearance) continue;
    if (distance < 0.05) {
      // Dead ahead: slide to the right of the heading so the choice stays stable between frames.
      tangent.set(dz, -dx);
      lateral.copy(tangent).multiplyScalar(-1);
    } else {
      lateral.multiplyScalar(1 / distance);
    }
    const closeness = 1 - distance / clearance;
    const imminence = 1 - Math.min(Math.max(along, 0) / lookahead, 1) * 0.6;
    // `lateral` points from the body towards the obstacle's axis; steer the opposite way.
    out.x -= lateral.x * closeness * imminence * 2.5;
    out.y -= lateral.y * closeness * imminence * 2.5;
  }
  return out;
}

/** Hard guarantee that a body never ends up inside a column or the plinth. */
export function pushOutOfObstacles(position: Vector3, bodyRadius: number): void {
  for (const o of OBSTACLES) {
    let dx = position.x - o.x;
    let dz = position.z - o.z;
    let distance = Math.hypot(dx, dz);
    const minimum = o.radius + bodyRadius;
    if (distance >= minimum) continue;
    if (distance < 1e-4) {
      dx = 1;
      dz = 0;
      distance = 1;
    }
    position.x = o.x + (dx / distance) * minimum;
    position.z = o.z + (dz / distance) * minimum;
  }
}

/** Seeded generator so creature layouts are the same on every load. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
