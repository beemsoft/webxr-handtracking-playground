import * as THREE from "../../vendor/three/build/three.webgpu.js";
import {
  mergeGeometries,
  mergeVertices,
} from "../../vendor/three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Fn,
  If,
  vec2,
  vec3,
  color,
  positionWorld,
  normalWorld,
  texture,
  bumpMap,
  mix,
  uniform,
  mx_noise_float,
  output,
  vec4,
  refract,
  float,
  attribute,
} from "../../vendor/three/build/three.tsl.js";
import { createConcreteTexture } from "./stone-texture.js";
import { applyCausticLighting } from "./caustic-lighting.js";
import { createMoss, createRootCover } from "./moss.js";
import { WATER_HEIGHT } from "./motion.js";
import {
  createStepNosing,
  createBeveledCylinder,
  createColumnGeometry,
} from "./stone-geometry.js";
import {
  TERRACE_START,
  TERRACE_COUNT,
  TERRACE_WIDTH,
  TERRACE_RISE,
  OUTER_TERRACE_RADIUS,
  PLINTH_RADIUS,
  PLINTH_TOP,
  COLUMNS,
  floorHeight,
} from "./architecture.js";

// The polished finish is composed over diffuse stone in post-processing.
// This is the artistic reflectance of the rough PMREM finish.
export const STONE_F0 = 0.1;

export function createRoom(scene, optics) {
  const stoneMap = createConcreteTexture(2048);
  const orbVisible = uniform(1);
  const mossAmount = uniform(1);
  const stoneBounce = uniform(1);
  const rootCover = createRootCover();
  const lightPosition = optics.lightPosition;
  const lensBlockage = Fn(() => {
    const p = positionWorld;
    const upstream = refract(
      p.sub(lightPosition).normalize(),
      vec3(0, 1, 0),
      float(1 / 1.333),
    ).negate();
    const t = optics.center.sub(p).dot(upstream).max(0);
    const miss = optics.center.sub(p.add(upstream.mul(t))).length();
    return miss
      .smoothstep(optics.radius.mul(0.82), optics.radius.mul(1.18))
      .oneMinus()
      .mul(orbVisible);
  });
  function stone(floor = false, bakedBounce = false) {
    const material = new THREE.MeshPhysicalNodeMaterial({
      roughness: floor ? 0.34 : 0.62,
      metalness: 0,
      // The finish supplies specular light once, in the reflection composite.
      specularIntensity: floor ? 0 : 1,
    });
    material.userData.polishedStone = floor;
    const field = Fn(() => {
      const n = normalWorld.abs(),
        p = positionWorld.mul(0.85);
      return texture(stoneMap, p.xz)
        .mul(n.y)
        .add(texture(stoneMap, p.xy).mul(n.z))
        .add(texture(stoneMap, p.zy).mul(n.x))
        .div(n.x.add(n.y).add(n.z));
    })();
    const moss = createMoss(field, mossAmount, rootCover.map);
    const mottling = mx_noise_float(positionWorld.mul(0.55), 0.12, 0.54);
    const base = color("#f0dfc5").mul(field.r.mul(0.4).add(mottling));
    material.colorNode = base;
    if (floor) {
      const tiles = positionWorld.xz.div(1.5);
      const tileX = tiles.x.add(tiles.y.floor().mod(2).mul(0.5));
      const edge = vec2(tileX, tiles.y).fract().sub(0.5).abs();
      const seam = edge.x
        .max(edge.y)
        .smoothstep(0.493, 0.499)
        .mul(0.2)
        .oneMinus();
      material.colorNode = base.mul(seam);
    }
    material.normalNode = bumpMap(
      field.b.add(moss.grain.mul(moss.mask).mul(0.08)),
      floor ? 0.016 : 0.024,
    );
    material.roughnessNode = floor
      ? mx_noise_float(positionWorld.mul(0.7), 0.08, 0.34)
          .add(mx_noise_float(positionWorld.mul(3.1), 0.025, 0))
          .clamp(0.22, 0.46)
      : field.g.mul(0.16).add(0.6);
    material.roughnessNode = mix(
      material.roughnessNode,
      moss.roughness,
      moss.mask,
    );
    const causticIllumination = Fn(() => {
      const p = positionWorld,
        n = normalWorld;
      const caustic = optics.causticIrradiance(p).toVar();
      If(n.y.greaterThan(0.5).and(p.xz.length().lessThan(5)), () => {
        // Light entering the sphere is redirected into its receiver map;
        // it must not also remain as undisturbed water caustics beneath it.
        caustic.mulAssign(lensBlockage().oneMinus());
        caustic.addAssign(
          texture(optics.orbMap.texture, p.xz.div(10).add(0.5))
            .rgb.div(0.16)
            .mul(orbVisible),
        );
      });
      return caustic;
    })();
    applyCausticLighting(material, optics, causticIllumination);
    const stoneColor = material.colorNode;
    material.colorNode = mix(stoneColor, moss.color, moss.mask);
    const litStone = output.rgb;
    // Baked irradiance belongs outside the direct-sun shadow term: it arrives
    // from the surrounding floor. Tint it by the actual stone/moss albedo.
    material.outputNode = vec4(
      bakedBounce
        ? litStone.add(
            attribute("bounceLight", "vec3")
              .mul(stoneBounce)
              .mul(mix(stoneColor, moss.color, moss.mask)),
          )
        : litStone,
      output.a,
    );
    return material;
  }
  const material = stone(false, true),
    floorMaterial = stone(true);
  const meshes = [];
  const warmStone = new THREE.Color("#e3d2b1");
  function bakeFloorBounce(geometry, height, bottom = -height / 2) {
    // Use each step's local height so the fill follows its riser and rounded
    // edge. Horizontal caps stay unlit by this term, with a dark base crease.
    const positions = geometry.attributes.position,
      normals = geometry.attributes.normal,
      bounce = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const t = THREE.MathUtils.clamp(
        (positions.getY(i) - bottom) / height,
        0,
        1,
      );
      const side = 1 - Math.abs(normals.getY(i));
      const amount =
        0.55 * side * (1 - t * 0.4) * THREE.MathUtils.smoothstep(t, 0, 0.17);
      bounce.set(
        [warmStone.r * amount, warmStone.g * amount, warmStone.b * amount],
        i * 3,
      );
    }
    geometry.setAttribute("bounceLight", new THREE.BufferAttribute(bounce, 3));
    return geometry;
  }
  function add(geometry, mat = material, name = "Stone") {
    // Zero fill on the other architecture keeps all risers and columns in
    // their existing shared material batch, without another draw or pass.
    if (!geometry.hasAttribute("bounceLight"))
      geometry.setAttribute(
        "bounceLight",
        new THREE.BufferAttribute(
          new Float32Array(geometry.attributes.position.count * 3),
          3,
        ),
      );
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  }
  const floor = add(
    new THREE.CircleGeometry(11.5, 192),
    floorMaterial,
    "Travertine floor",
  );
  floor.rotation.x = -Math.PI / 2;
  // The final tread becomes a broad shelf whose outer edge is hidden by fog.
  for (let i = 0; i < TERRACE_COUNT; i++) {
    const r = TERRACE_START + i * TERRACE_WIDTH,
      y = TERRACE_RISE * (i + 1),
      outerRadius =
        i === TERRACE_COUNT - 1 ? OUTER_TERRACE_RADIUS : r + TERRACE_WIDTH;
    const ring = add(
      new THREE.RingGeometry(r + 0.016, outerRadius, 192),
      floorMaterial,
      "Circular terrace",
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    const riser = add(
      bakeFloorBounce(createStepNosing(r, TERRACE_RISE), TERRACE_RISE, 0),
      material,
      "Terrace riser",
    );
    riser.position.y = y - TERRACE_RISE;
  }
  function cylinder(radius, height, y, mat = material) {
    const obj = add(
      bakeFloorBounce(
        createBeveledCylinder(
          radius,
          height,
          radius === PLINTH_RADIUS ? 0.035 : 0.016,
        ),
        height,
      ),
      mat,
    );
    obj.position.y = y;
    return obj;
  }
  // A broad, shallow dais gives the foreground its concentric stone edges.
  for (const [r, h] of [
    [4.05, 0.06],
    [3.8, 0.12],
    [3.55, 0.2],
  ])
    cylinder(r, h, h / 2, [material, floorMaterial, material]);
  cylinder(PLINTH_RADIUS + 0.07, 0.05, 0.225);
  // Polish the cap; the vertical side remains diffuse limestone, like the
  // stair risers. Otherwise the pedestal itself mirrors the floor below it.
  const pedestal = cylinder(PLINTH_RADIUS, 0.3, PLINTH_TOP - 0.15, [
    material,
    floorMaterial,
    material,
  ]);
  pedestal.name = "Crystal plinth";
  function pillar(x, z, bottom, top, r) {
    const geometry = createColumnGeometry(r, top - bottom);
    const column = add(geometry, material, "Stone column");
    column.position.set(x, bottom, z);
  }
  for (const { x, z, radius } of COLUMNS)
    pillar(
      x,
      z,
      floorHeight(Math.hypot(x, z) - radius * 1.35),
      WATER_HEIGHT + 0.04,
      radius,
    );
  const sun = new THREE.PointLight(0xfff0db, 260, 0, 2);
  sun.name = "Sun above the globe";
  sun.position.copy(lightPosition.value);
  optics.sun.value.copy(sun.position).normalize();
  const rise = (sun.position.y - WATER_HEIGHT) / optics.sun.value.y;
  optics.aperture.value.set(
    sun.position.x - optics.sun.value.x * rise,
    sun.position.z - optics.sun.value.z * rise,
  );
  scene.add(sun);
  sun.castShadow = true;
  // main.js refreshes this once when the fish move. All reflection views
  // then share the same six shadow faces for this animation frame.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 2;
  Object.assign(sun.shadow.camera, {
    near: 0.5,
    far: 32,
  });
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.0002;
  // The PMREM supplies broad canopy and stone-bounce fill. Only the direct
  // sun remains as a light object, preserving real shadows and caustic focus.

  // The architecture is static. Bake it into one mesh per material so the
  // six cube faces and the water mirror don't resubmit every stair and column.
  // Keep the plinth separate for optical validation and material inspection.
  const batches = new Map();
  for (const mesh of meshes.filter((mesh) => mesh !== pedestal)) {
    mesh.updateMatrixWorld();
    const source = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    source.applyMatrix4(mesh.matrixWorld);
    const groups = Array.isArray(mesh.material)
      ? source.groups
      : [
          {
            start: 0,
            count: source.attributes.position.count,
            materialIndex: 0,
          },
        ];
    for (const group of groups) {
      const mat = Array.isArray(mesh.material)
        ? mesh.material[group.materialIndex]
        : mesh.material;
      const geometry = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv", "bounceLight"]) {
        const attribute = source.getAttribute(name),
          size = attribute.itemSize;
        geometry.setAttribute(
          name,
          new THREE.Float32BufferAttribute(
            attribute.array.slice(
              group.start * size,
              (group.start + group.count) * size,
            ),
            size,
          ),
        );
      }
      if (!batches.has(mat)) batches.set(mat, []);
      batches.get(mat).push(geometry);
    }
    source.dispose();
    mesh.geometry.dispose();
    scene.remove(mesh);
  }
  meshes.length = 0;
  meshes.push(pedestal);
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    add(
      mergeVertices(merged),
      mat,
      mat.userData.polishedStone
        ? "Polished stone terraces"
        : "Limestone architecture",
    );
    merged.dispose();
    for (const geometry of geometries) geometry.dispose();
  }
  return {
    meshes,
    material,
    floorMaterial,
    pedestal,
    orbVisible,
    mossAmount,
    stoneBounce,
    growMoss: rootCover.grow,
    sun,
    stoneMap,
    dispose() {
      const geometries = new Set(),
        materials = new Set();
      for (const mesh of meshes) {
        geometries.add(mesh.geometry);
        for (const material of [mesh.material].flat()) materials.add(material);
        scene.remove(mesh);
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      stoneMap.dispose();
      rootCover.map.dispose();
    },
  };
}
