import * as THREE from "../../vendor/three/build/three.webgpu.js";
import {
  floorHeight,
  COLUMNS,
  TERRACE_START,
  TERRACE_WIDTH,
  TERRACE_COUNT,
} from "./architecture.js";
import { createFishTexture } from "./fish-texture.js";
import { applyCausticLighting } from "./caustic-lighting.js";
import { createFishGeometry } from "./fish-geometry.js";
import { createAlgaeGeometry } from "./algae-geometry.js";
import { createAlgaeMaterial } from "./algae-material.js";
import { createFishSimulation } from "./fish-simulation.js";
import {
  FISH_SCHOOLS,
  SCHOOL_SIZE,
  SCHOOL_FISH_COUNT,
  FISH_COUNT,
} from "./fish-schools.js";
import {
  Fn,
  uniform,
  vec2,
  vec3,
  positionGeometry,
  positionPrevious,
  normalGeometry,
  normalLocal,
  buffer,
  storage,
  vec4,
  instanceIndex,
  mix,
  color,
  diffuseColor,
  attribute,
  texture,
  normalMap,
  OnAfterObjectUpdate,
} from "../../vendor/three/build/three.tsl.js";

// All motion shares the water clock: pause, speed and reset affect the entire sea.
export function createMarineLife(scene, optics) {
  const group = new THREE.Group();
  group.name = "Marine life";
  scene.add(group);
  // Keep the established plant layout independent of the number of fish.
  let seed = 3763512237;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const geometries = [],
    materials = [];
  const dummy = new THREE.Object3D();
  const direction = new THREE.Vector3(),
    up = new THREE.Vector3(),
    side = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0),
    basis = new THREE.Matrix4(),
    roll = new THREE.Quaternion();
  const forward = new THREE.Vector3(1, 0, 0);
  const simulation = createFishSimulation();
  const schoolSize = SCHOOL_SIZE,
    schoolingFish = SCHOOL_FISH_COUNT;
  function instances(geometry, material, count, name) {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    return mesh;
  }

  const fishGeometry = createFishGeometry();
  const { texture: fishTexture, normalTexture } = createFishTexture();
  const scaleUV = attribute("scaleUV", "vec2");
  const scales = texture(fishTexture, scaleUV);
  const eye = attribute("skin", "float").equal(0);
  const fin = attribute("skin", "float").lessThan(0);
  const skin = attribute("skin", "float")
    .max(0)
    .mul(positionGeometry.x.smoothstep(0.11, 0.19).oneMinus());
  const fishMaterial = new THREE.MeshPhysicalNodeMaterial({
    vertexColors: true,
    metalness: 0.24,
    roughness: 0.28,
    side: THREE.DoubleSide,
    iridescence: 0.65,
    iridescenceIOR: 1.3,
  });
  fishMaterial.userData.screenReflection = true;
  const fishRelief = uniform(1);
  fishMaterial.normalNode = normalMap(
    texture(normalTexture, scaleUV),
    vec2(fishRelief.mul(skin)),
  );
  // Boost the reflective scales without increasing the schools’ emitted light.
  const fishShine = uniform(8);
  fishMaterial.specularIntensityNode = mix(eye.select(1.6, 1), fishShine, skin);
  fishMaterial.metalnessNode = eye.select(0, mix(0.04, 0.24, skin));
  fishMaterial.roughnessNode = eye.select(
    0.08,
    mix(0.42, scales.a.mul(0.13).add(0.16), skin),
  );
  fishMaterial.iridescenceNode = skin.mul(0.65);
  fishMaterial.iridescenceThicknessNode = scales.b.mul(260).add(140);
  const swimData = buffer(simulation.swim, "vec4", simulation.fish.length);
  let previousFishMatrices = null,
    previousSwim = null,
    previousPoseVersion = -1;
  fishMaterial.positionNode = Fn(([], builder) => {
    const p = positionGeometry.toVar(),
      n = normalGeometry.toVar();
    const swim = swimData.element(instanceIndex);
    const tail = p.x.negate().add(0.11).max(0);
    const phase = swim.x.add(p.x.mul(17));
    const amplitude = tail.pow2().mul(0.43).mul(swim.y);
    const slope = phase
      .cos()
      .mul(17)
      .mul(amplitude)
      .sub(phase.sin().mul(tail).mul(0.86).mul(swim.y));
    p.z.addAssign(phase.sin().mul(amplitude));
    // Inverse-transpose of the bend's Jacobian, then the instance rotation.
    // Keeping the normals on the flexing skin prevents sliding highlights.
    n.x.subAssign(slope.mul(n.z));
    // Schools can exceed the 64 KiB uniform-buffer limit. Keep transforms in
    // a read-only storage buffer shared with the instance attribute updates.
    const matrix = storage(fish.instanceMatrix, "mat4")
      .toReadOnly()
      .element(instanceIndex);
    normalLocal.assign(matrix.mul(vec4(n, 0)).xyz.normalize());
    if (builder.needsPreviousData()) {
      // Native instance history contains the undeformed mesh. Preserve the
      // actual previous tail pose as well, or paused fish report false motion.
      if (!previousFishMatrices) {
        previousFishMatrices = fish.instanceMatrix.clone();
        previousSwim = new THREE.StorageBufferAttribute(
          simulation.swim.slice(),
          4,
        );
        previousPoseVersion = fish.instanceMatrix.version;
      }
      const previous = positionGeometry.toVar();
      const priorSwim = storage(previousSwim, "vec4")
        .toReadOnly()
        .element(instanceIndex);
      previous.z.addAssign(
        priorSwim.x
          .add(previous.x.mul(17))
          .sin()
          .mul(previous.x.negate().add(0.11).max(0).pow2())
          .mul(0.43)
          .mul(priorSwim.y),
      );
      positionPrevious.assign(
        storage(previousFishMatrices, "mat4")
          .toReadOnly()
          .element(instanceIndex)
          .mul(vec4(previous, 1)).xyz,
      );
      OnAfterObjectUpdate(() => {
        if (previousPoseVersion === fish.instanceMatrix.version) return;
        previousFishMatrices.array.set(fish.instanceMatrix.array);
        previousSwim.array.set(simulation.swim);
        previousFishMatrices.needsUpdate = previousSwim.needsUpdate = true;
        previousPoseVersion = fish.instanceMatrix.version;
      });
    }
    return matrix.mul(vec4(p, 1)).xyz;
  })();
  const fishGlow = uniform(0.3);
  applyCausticLighting(fishMaterial, optics);
  fishMaterial.emissiveNode = diffuseColor.rgb.mul(0.1).add(
    diffuseColor.rgb
      .mul(fishGlow)
      .mul(instanceIndex.lessThan(schoolingFish).select(1, 0))
      .mul(mix(0.45, 1, skin)),
  );
  const fish = instances(
    fishGeometry,
    fishMaterial,
    FISH_COUNT,
    "Amber, azure, green and yellow schools, and reef fish",
  );
  fish.instanceMatrix = new THREE.StorageInstancedBufferAttribute(
    fish.instanceMatrix.array,
    16,
  ).setUsage(THREE.DynamicDrawUsage);
  fish.receiveShadow = true;
  fish.castShadow = true;
  fish.userData.opticalSurface = 5;
  const fishData = simulation.fish;
  let tintSeed = 1073;
  const tintRandom = () =>
    (tintSeed = (Math.imul(tintSeed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const fishColor = new THREE.Color();
  for (let i = 0; i < fish.count; i++) {
    const school = FISH_SCHOOLS[fishData[i].school];
    fishColor.setHSL(
      school
        ? school.hue + tintRandom() * school.hueRange
        : [0.12, 0.5, 0.88][i % 3],
      0.78,
      0.5 + tintRandom() * 0.08,
    );
    fish.setColorAt(i, fishColor);
  }
  fish.instanceColor.needsUpdate = true;
  // Uniform-buffer array elements need a 16-byte stride in WGSL.
  const tintData = new Float32Array(fish.count * 4);
  for (let i = 0; i < fish.count; i++)
    tintData.set(fish.instanceColor.array.subarray(i * 3, i * 3 + 3), i * 4);
  const fishTints = buffer(tintData, "vec4", fish.count);
  fish.instanceColor = null;
  // Native transmitted shadows retain each school's color. Thin fins pass
  // more light than the body; eyes remain opaque. This only filters sunlight
  // in the shadow map and does not add emission or transparent surface draws.
  fishMaterial.castShadowNode = vec4(
    eye.select(
      vec3(0),
      fishTints.element(instanceIndex).rgb.mul(fin.select(0.55, 0.22)),
    ),
    1,
  );
  fishMaterial.colorNode = Fn(() => {
    const tint = fishTints.element(instanceIndex).rgb;
    const stripe = positionGeometry.y
      .smoothstep(-0.075, 0.085)
      .mul(positionGeometry.x.smoothstep(-0.2, -0.1))
      .mul(0.4);
    let accent = color(FISH_SCHOOLS.at(-1).accent);
    for (let i = FISH_SCHOOLS.length - 2; i >= 0; i--)
      accent = instanceIndex
        .lessThan((i + 1) * schoolSize)
        .select(color(FISH_SCHOOLS[i].accent), accent);
    const upper = mix(
      tint,
      accent,
      instanceIndex.lessThan(schoolingFish).select(stripe, 0),
    );
    let belly = tint;
    for (let i = FISH_SCHOOLS.length - 1; i >= 0; i--)
      belly = instanceIndex
        .lessThan((i + 1) * schoolSize)
        .select(
          FISH_SCHOOLS[i].belly ? color(FISH_SCHOOLS[i].belly) : tint,
          belly,
        );
    // Blend across the full body height instead of a narrow band below the
    // midline, so the school color flows gradually into its belly accent.
    const underside = positionGeometry.y
      .negate()
      .smoothstep(-0.075, 0.085)
      .mul(0.75)
      .mul(instanceIndex.lessThan(schoolingFish).select(1, 0));
    return eye.select(
      vec3(1),
      mix(upper, belly, underside)
        .mul(mix(1, scales.r, skin))
        .mul(fin.select(scales.g, 1)),
    );
  })();
  function plantMesh(geometry, count, name) {
    const material = createAlgaeMaterial(optics);
    const mesh = instances(geometry, material, count, name);
    mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(
      mesh.instanceMatrix.array,
      16,
    ).setUsage(THREE.StaticDrawUsage);
    mesh.receiveShadow = true;
    return mesh;
  }
  const algae = plantMesh(
    createAlgaeGeometry(),
    1008,
    "Algae growing between the terraces",
  );
  const smallAlgae = plantMesh(
    createAlgaeGeometry(true),
    4096,
    "Short algae in terrace seams",
  );
  const roots = [];
  for (let i = 0; i < algae.count; i++) {
    const cluster = Math.floor(i / 28),
      column = cluster < COLUMNS.length,
      tall = column && i % 28 < 9;
    let a = column
      ? Math.PI * 0.25 + (cluster % 4) * Math.PI * 0.5
      : cluster * 2.399963;
    let r = column ? 6.15 : [6.25, 7.55, 8.85, 10.15][cluster % 4];
    // Keep the center and foreground walkway clear; plant the column bases
    // and the side/back terrace seams in dense, varied tufts.
    if (!column && Math.cos(a) > 0.65) a += Math.PI / 2;
    const spread = column ? 0.65 + random() * 0.23 : random() * 0.3;
    const around = random() * Math.PI * 2;
    const site = COLUMNS[cluster % COLUMNS.length];
    const x = (column ? site.x : Math.sin(a) * r) + Math.cos(around) * spread;
    const z = (column ? site.z : Math.cos(a) * r) + Math.sin(around) * spread;
    r = Math.hypot(x, z);
    dummy.position.set(x, floorHeight(r) + 0.005, z);
    roots.push({ x, z, radius: column ? 0.28 : 0.2 });
    dummy.rotation.set(
      (random() - 0.5) * 0.55,
      random() * Math.PI * 2,
      (random() - 0.5) * 0.7,
    );
    dummy.scale.set(
      tall ? 1.1 + random() : 0.55 + random() * 0.7,
      tall
        ? 1.2 + random() * 1.2
        : 0.18 + random() ** 2 * (column ? 0.75 : 1.1),
      1,
    );
    dummy.updateMatrix();
    algae.setMatrixAt(i, dummy.matrix);
  }
  algae.instanceMatrix.needsUpdate = true;
  // Small plants use a finer distribution and a lighter geometry. The tall
  // silhouettes retain their original tessellation and height variation.
  for (let i = 0; i < smallAlgae.count; i++) {
    const patch = Math.floor(i / 64),
      columnPatch = patch < COLUMNS.length;
    const site = COLUMNS[patch % COLUMNS.length];
    let angle = patch * 2.399963 + (random() - 0.5) * 0.12;
    if (!columnPatch && Math.cos(angle) > 0.6) angle += Math.PI / 2;
    const terrace = patch % TERRACE_COUNT;
    const radius =
      TERRACE_START + terrace * TERRACE_WIDTH + 0.08 + random() * 0.16;
    const spread = 0.6 + random() * 0.5,
      around = random() * Math.PI * 2;
    const x = columnPatch
      ? site.x + Math.cos(around) * spread
      : Math.sin(angle) * radius;
    const z = columnPatch
      ? site.z + Math.sin(around) * spread
      : Math.cos(angle) * radius;
    dummy.position.set(x, floorHeight(Math.hypot(x, z)) + 0.006, z);
    dummy.rotation.set(
      (random() - 0.5) * 0.35,
      random() * Math.PI * 2,
      (random() - 0.5) * 0.45,
    );
    dummy.scale.set(
      0.45 + random() * 0.85,
      0.09 + random() ** 1.5 * 0.4,
      0.6 + random() * 0.5,
    );
    dummy.updateMatrix();
    smallAlgae.setMatrixAt(i, dummy.matrix);
    roots.push({ x, z, radius: 0.11 + random() * 0.07 });
  }
  smallAlgae.instanceMatrix.needsUpdate = true;

  const schools = FISH_SCHOOLS.map(() => ({
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
  }));
  let previousTime = null,
    previousVisibility = null;
  function update(time, settings) {
    fishGlow.value = settings.fishGlow;
    fishShine.value = settings.fishShine;
    fishRelief.value = settings.fishRelief;
    fish.visible = settings.fish;
    algae.visible = smallAlgae.visible = settings.algae;
    if (time === previousTime && fish.visible === previousVisibility) return;
    previousTime = time;
    previousVisibility = fish.visible;
    simulation.update(time);
    if (fish.visible) {
      for (const school of schools) {
        school.position.set(0, 0, 0);
        school.direction.set(0, 0, 0);
      }
      for (let i = 0; i < fish.count; i++) {
        const f = fishData[i];
        dummy.position.fromArray(simulation.positions, i * 3);
        direction.fromArray(simulation.headings, i * 3).normalize();
        if (f.school < schools.length) {
          schools[f.school].position.add(dummy.position);
          schools[f.school].direction.add(direction);
        }
        // An explicit upright frame avoids the antipodal shortest-arc flip.
        side.crossVectors(direction, worldUp).normalize();
        up.crossVectors(side, direction).normalize();
        basis.makeBasis(direction, up, side);
        dummy.quaternion.setFromRotationMatrix(basis);
        roll.setFromAxisAngle(forward, simulation.banks[i]);
        dummy.quaternion.multiply(roll);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        fish.setMatrixAt(i, dummy.matrix);
      }
      fish.instanceMatrix.needsUpdate = true;
      for (const school of schools) {
        school.position.divideScalar(schoolSize);
        school.direction.normalize();
      }
    }
  }
  return {
    group,
    fish,
    schools,
    simulation,
    algae,
    smallAlgae,
    roots,
    update,
    dispose() {
      scene.remove(group);
      for (const mesh of [fish, algae, smallAlgae]) mesh.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      fishTexture.dispose();
      normalTexture.dispose();
      previousFishMatrices?.dispose();
      previousSwim?.dispose();
    },
  };
}
