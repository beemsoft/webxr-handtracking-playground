import * as THREE from "../../vendor/three/build/three.webgpu.js";
import { WATER_HEIGHT } from "./motion.js";

// Explicit capture keeps a single reflection image for the main camera. Cube
// probes can sample it without triggering six additional mirror renders.
export function createWaterReflection() {
  const target = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    samples: 4,
  });
  const camera = new THREE.PerspectiveCamera();
  target.texture.name = "output";
  const matrix = new THREE.Matrix4();
  const direction = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const size = new THREE.Vector2();
  let captures = 0;
  return {
    target,
    camera,
    matrix,
    get captures() {
      return captures;
    },
    render(renderer, scene, view, water) {
      renderer.getDrawingBufferSize(size);
      const scale = Math.min(1, 1200 / size.x);
      target.setSize(Math.round(size.x * scale), Math.round(size.y * scale));
      camera.copy(view, false);
      camera.position.copy(view.position);
      camera.position.y = WATER_HEIGHT * 2 - view.position.y;
      view.getWorldDirection(direction);
      direction.y *= -1;
      camera.up.copy(view.up);
      camera.up.y *= -1;
      camera.lookAt(lookAt.copy(camera.position).add(direction));
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      const previous = renderer.getRenderTarget();
      const visible = water.visible;
      water.visible = false;
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        captures++;
      } finally {
        water.visible = visible;
        renderer.setRenderTarget(previous);
      }
    },
    dispose() {
      target.dispose();
    },
  };
}
