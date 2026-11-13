import * as THREE from "../../vendor/three/build/three.webgpu.js";
import { applyCausticLighting } from "./caustic-lighting.js";
import {
  Fn,
  instanceIndex,
  normalGeometry,
  normalLocal,
  positionGeometry,
  storage,
  transformNormal,
  vec3,
  vec4,
} from "../../vendor/three/build/three.tsl.js";

export function createAlgaeMaterial(optics) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    roughness: 0.72,
    metalness: 0,
    transmission: 0.45,
    thickness: 0.02,
    ior: 1.25,
  });
  // Rough refraction with full coverage, without alpha noise or self-emission.
  material.colorNode = vec3(
    instanceIndex.toFloat().mul(2.4).sin().mul(0.12).add(0.88),
  );
  material.positionNode = Fn(([], builder) => {
    builder.objectSpecific = true;
    const matrix = storage(builder.object.instanceMatrix, "mat4")
      .toReadOnly()
      .element(instanceIndex);
    const p = positionGeometry.toVar(),
      n = normalGeometry.toVar();
    const root = matrix.element(3).xyz;
    // Nearby plants share a slow current; a smaller flutter varies per blade.
    const phase = optics.time
      .mul(0.85)
      .add(root.x.mul(0.42))
      .add(root.z.mul(0.31))
      .add(p.y.mul(2.8));
    const flutter = optics.time
      .mul(1.75)
      .add(instanceIndex.toFloat().mul(1.13))
      .add(p.y.mul(6.5));
    const sway = 0.3,
      flutterAmount = 0.075;
    const flow = phase.sin().mul(sway).add(flutter.sin().mul(flutterAmount));
    const derivative = phase
      .cos()
      .mul(sway * 2.8)
      .add(flutter.cos().mul(flutterAmount * 6.5));
    const direction = vec3(0.9, 0, 0.4);
    const alongX = matrix.element(0).xyz.normalize().dot(direction),
      alongZ = matrix.element(2).xyz.normalize().dot(direction);
    const lean = instanceIndex.toFloat().mul(1.73).sin().mul(0.08);
    const bendX = flow.mul(alongX).add(lean);
    const bendZ = flow.mul(alongZ).add(phase.cos().mul(flutterAmount));
    const dx = bendX
      .mul(p.y)
      .mul(2)
      .add(derivative.mul(alongX).mul(p.y.pow2()));
    const dz = bendZ
      .mul(p.y)
      .mul(2)
      .add(
        derivative
          .mul(alongZ)
          .sub(phase.sin().mul(flutterAmount * 2.8))
          .mul(p.y.pow2()),
      );
    // The root stays fixed; the inverse-transpose follows the bending blade.
    n.y.subAssign(dx.mul(n.x).add(dz.mul(n.z)));
    p.x.addAssign(bendX.mul(p.y.pow2()));
    p.z.addAssign(bendZ.mul(p.y.pow2()));
    normalLocal.assign(transformNormal(n, matrix));
    return matrix.mul(vec4(p, 1)).xyz;
  })();
  applyCausticLighting(material, optics);
  return material;
}
