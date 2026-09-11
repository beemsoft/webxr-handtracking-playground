import * as THREE from 'three';
import { historyGLSL } from '../ocean/CoastalField';
import { noiseGLSL } from '../ocean/NoiseGLSL';
import { injectCausticLighting } from './TerrainGenerator';

export interface RockInstance {
  x: number;
  z: number;
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rotation: number;
}

export interface RocksResult {
  rocks: THREE.InstancedMesh;
  rockInstances: RockInstance[];
  rockBuckets: Map<string, RockInstance[]>;
}

export function createRocks(
  scene: THREE.Scene,
  compact: boolean,
  terrainHeight: (x: number, z: number) => number,
  terrainSlope: (x: number, z: number) => number,
  coastDistance: (x: number, z: number) => number,
  timeUniform: { value: number },
  foamUniforms: { [key: string]: THREE.IUniform },
  skyUniforms: { [key: string]: THREE.IUniform },
  causticUniforms: { [key: string]: THREE.IUniform },
  skyGLSL: string
): RocksResult {
  const TAU = Math.PI * 2;
  let seed = 192731;
  const random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const hash = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x: number, z: number) => {
    const ix = Math.floor(x),
      iz = Math.floor(z),
      fx = x - ix,
      fz = z - iz;
    const u = fx * fx * (3 - 2 * fx),
      v = fz * fz * (3 - 2 * fz);
    return (
      (1 - v) * ((1 - u) * hash(ix, iz) + u * hash(ix + 1, iz)) +
      v * ((1 - u) * hash(ix, iz + 1) + u * hash(ix + 1, iz + 1))
    );
  };

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const rockInstances: RockInstance[] = [];
  const rockBuckets = new Map<string, RockInstance[]>();

  const addRock = (x: number, z: number, scale: number) => {
    const h = terrainHeight(x, z);
    const sx = scale * (0.8 + random() * 0.7),
      sy = scale * (0.65 + random() * 0.6),
      sz = scale * (0.7 + random() * 0.6);
    const r: RockInstance = { x, z, y: h + sy * 0.15, sx, sy, sz, rotation: random() * TAU };
    rockInstances.push(r);
    const key = `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
    if (!rockBuckets.has(key)) rockBuckets.set(key, []);
    rockBuckets.get(key)!.push(r);
  };

  for (let i = 0; i < 1700 && rockInstances.length < 155; i++) {
    const x = random() * 480 - 225,
      z = random() * 255 - 135;
    const h = terrainHeight(x, z),
      d = coastDistance(x, z);
    const exposed = z < -35 || x < -144 || x > 173;
    if (exposed && d > -11 && d < 6 && h > -1.4) {
      const scale = 1.1 + (random() ** 1.8) * 4.2;
      addRock(x, z, scale);
      if (random() > 0.45) addRock(x + (random() - 0.5) * 7, z + (random() - 0.5) * 7, scale * 0.6);
    } else if (h > 25 && terrainSlope(x, z) > 0.75 && random() > 0.6) {
      addRock(x, z, 2.5 + random() * 4.5);
    }
  }

  const rockGeometry = new THREE.IcosahedronGeometry(1, 3);
  const rockPositions = rockGeometry.attributes.position;
  for (let i = 0; i < rockPositions.count; i++) {
    const x = rockPositions.getX(i),
      y = rockPositions.getY(i),
      z = rockPositions.getZ(i);
    const bump = 0.93 + noise(x * 3.1 + y * 1.8, z * 3.1 - y * 2.2) * 0.14;
    rockPositions.setXYZ(i, x * bump, y * bump, z * bump);
  }
  rockGeometry.normalizeNormals();

  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xa49f8d, roughness: 0.92 });
  rockMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, foamUniforms, skyUniforms, { uTime: timeUniform });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone = (instanceMatrix * vec4(position, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vStone;\n${noiseGLSL}\n${historyGLSL}\n${skyGLSL.replace('uStorm, ', '')}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
          #include <color_fragment>
          float stoneFootprint = max(length(dFdx(vStone)), length(dFdy(vStone)));
          float mineral = mix(fractal(vStone.xz * 0.8 + vStone.y * 0.6), 0.5, smoothstep(0.2, 1.3, stoneFootprint));
          diffuseColor.rgb *= 0.75 + mineral * 0.4;
          vec4 stoneHistory = coastalHistory(vStone.xz);
          float stoneWet = max(1.0 - smoothstep(-0.3, 0.15, vStone.y), stoneHistory.a * (1.0 - smoothstep(0.1, 1.9 + mineral * 0.45, vStone.y)));
          float exposedStone = smoothstep(-0.2, 0.15, vStone.y);
          diffuseColor.rgb *= 1.0 - stoneWet * 0.29;
        `
      );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.92, 0.31, stoneWet * exposedStone);'
    );

    injectCausticLighting(shader, 'vStone', causticUniforms, skyUniforms, compact);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      /* glsl */ `
        #include <lights_fragment_end>
        vec3 wetView = normalize(vViewPosition);
        vec3 wetReflection = reflect(-inverseTransformDirection(wetView, viewMatrix), inverseTransformDirection(normal, viewMatrix));
        float wetFresnel = 0.0204 + 0.9796 * pow(1.0 - clamp(dot(normal, wetView), 0.0, 1.0), 5.0);
        reflectedLight.directSpecular *= mix(0.12, 1.0, exposedStone);
        reflectedLight.indirectSpecular *= mix(0.12, 1.0, exposedStone);
        if (stoneWet * exposedStone > 0.002) reflectedLight.indirectSpecular += atmosphereFiltered(wetReflection, 2.0) * wetFresnel * stoneWet * exposedStone * 0.45;
      `
    );
  };

  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockInstances.length);
  rockInstances.forEach((r, i) => {
    dummy.position.set(r.x, r.y, r.z);
    dummy.rotation.set((random() - 0.5) * 0.4, r.rotation, (random() - 0.5) * 0.3);
    dummy.scale.set(r.sx, r.sy, r.sz);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, color.setRGB(0.78 + random() * 0.2, 0.79 + random() * 0.17, 0.76 + random() * 0.17));
  });
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);

  return { rocks, rockInstances, rockBuckets };
}
