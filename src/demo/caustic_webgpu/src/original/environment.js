import * as THREE from "../../vendor/three/build/three.webgpu.js";
import { Fn, vec3, positionLocal, cubeTexture } from "../../vendor/three/build/three.tsl.js";

// Distant, scattered illumination only. The scene's point sun supplies direct
// lighting and shadows; this broad canopy and stone bounce replace fill lights.
export function createUnderwaterEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(10, 32, 16);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    toneMapped: false,
    depthWrite: false,
  });
  material.colorNode = Fn(() => {
    const direction = positionLocal.normalize();
    const above = direction.y.max(0);
    const below = direction.y.negate().max(0);
    // A broad upper hemisphere lights horizontal treads and vertical risers
    // even where the point sun is occluded. Keep its opening a separate lobe.
    const canopy = above.pow(1.6);
    const opening = direction.y.sub(1).mul(18).exp();
    return vec3(0.025, 0.05, 0.06)
      .add(vec3(0.34, 0.46, 0.48).mul(canopy))
      .add(vec3(0.24, 0.2, 0.14).mul(below.pow(0.7)))
      .add(vec3(1.8, 1.75, 1.5).mul(opening));
  })();
  scene.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  let target;
  try {
    target = generator.fromScene(scene, 0.025, 0.1, 20, { size: 256 });
    target.texture.name = "Underwater canopy and limestone bounce PMREM";
  } finally {
    generator.dispose();
    geometry.dispose();
    material.dispose();
  }

  // Grains have no preferred normal. Average the roughest PMREM mip over six
  // directions for their scattered ambient light, using the same environment.
  const directions = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const particleFill = Fn(() => {
    const sum = vec3(0).toVar();
    for (const direction of directions)
      sum.addAssign(
        cubeTexture(target.texture, vec3(...direction)).level(
          target.texture.mipmaps.length - 1,
        ).rgb,
      );
    return sum.mul(0.2 / directions.length);
  })();
  return {
    texture: target.texture,
    target,
    particleFill,
    dispose: () => target.dispose(),
  };
}
