import * as THREE from 'three';
import { historyGLSL } from '../ocean/CoastalField';
import { noiseGLSL } from '../ocean/NoiseGLSL';

export interface TerrainResult {
  terrain: THREE.Mesh;
  terrainGeometry: THREE.PlaneGeometry;
  terrainMaterial: THREE.MeshStandardMaterial;
  heightMap: THREE.DataTexture;
  bottomMap: THREE.DataTexture;
  heightData: Uint16Array;
  bottomData: Uint8Array;
  terrainSize: number;
  mapResolution: number;
  terrainHeight: (x: number, z: number) => number;
  terrainSlope: (x: number, z: number) => number;
  coastDistance: (x: number, z: number) => number;
  rockiness: (x: number, z: number, h: number, slope: number) => number;
  seabedHeight: (x: number, z: number) => number;
}

export function createTerrain(
  scene: THREE.Scene,
  compact: boolean,
  timeUniform: { value: number },
  foamUniforms: { [key: string]: THREE.IUniform },
  skyUniforms: { [key: string]: THREE.IUniform },
  causticUniforms: { [key: string]: THREE.IUniform },
  skyGLSL: string,
  rockBuckets: Map<string, Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; rotation: number }>>
): TerrainResult {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const smooth = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
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
    return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), u), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
  };
  const fbm = (x: number, z: number) =>
    noise(x, z) * 0.56 +
    noise(x * 2.03 + 23.1, z * 2.03 - 17.7) * 0.28 +
    noise(x * 4.11 - 9.2, z * 4.11 + 31.4) * 0.16;
  const smin = (a: number, b: number, k: number) => {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
  };
  const ellipse = (x: number, z: number, cx: number, cz: number, rx: number, rz: number, a: number) => {
    const c = Math.cos(a),
      s = Math.sin(a),
      px = x - cx,
      pz = z - cz;
    const qx = px * c - pz * s,
      qz = px * s + pz * c;
    const k0 = Math.hypot(qx / rx, qz / rz),
      k1 = Math.hypot(qx / (rx * rx), qz / (rz * rz));
    return k1 < 0.000001 ? -Math.min(rx, rz) : (k0 * (k0 - 1)) / k1;
  };

  const coastDistance = (x: number, z: number) => {
    const px = x + (fbm(x * 0.012 + 40, z * 0.012) - 0.5) * 26;
    const pz = z + (fbm(x * 0.013, z * 0.013 + 70) - 0.5) * 21;
    let d = ellipse(px, pz, -32, -10, 149, 95, 0.22);
    d = smin(d, ellipse(px, pz, -120, -36, 72, 73, -0.38), 25);
    d = smin(d, ellipse(px, pz, 108, -28, 113, 47, -0.09), 23);
    d = smin(d, ellipse(px, pz, -110, 59, 61, 46, 0.45), 16);
    d = smin(d, ellipse(px, pz, 192, 1, 43, 46, -0.3), 18);
    const cove = ellipse(px, pz, 50, 83, 91, 65, -0.32);
    d = -smin(-d, cove, 12);
    return d + (noise(x * 0.11, z * 0.11) - 0.5) * 2.4 + (noise(x * 0.043 - 80, z * 0.043) - 0.5) * 6;
  };

  const terrainHeight = (x: number, z: number) => {
    const d = coastDistance(x, z);
    if (d > 0) {
      const sheltered = Math.exp(-(((x - 40) / 160) ** 2 + ((z - 88) / 100) ** 2));
      const shelf = 34 + 70 * sheltered + 25 * noise(x * 0.013, z * 0.013);
      let h = -0.09 * d - 0.008 * Math.max(0, d - shelf) ** 2;
      h += 2.1 * sheltered * Math.exp(-(((z - 100 - 12 * Math.sin(x * 0.021)) / 18) ** 2)) * smooth(10, 32, d);
      h -= 3.7 * Math.exp(-(((x - 28 - (z - 85) * 0.23) / 15) ** 2 + ((z - 117) / 53) ** 2)) * smooth(3, 25, d);
      h += (fbm(x * 0.045, z * 0.045) - 0.5) * Math.min(d * 0.055, 1.7);
      return Math.max(-190, Math.min(-0.025, h));
    }
    const inland = -d;
    const cliff = smooth(15, -65, z) * (0.45 + 0.55 * noise(x * 0.016, z * 0.016));
    const h1 = 47 * Math.exp(-(((x + 71) / 75) ** 2 + ((z + 23) / 62) ** 2));
    const h2 = 32 * Math.exp(-(((x - 15) / 61) ** 2 + ((z + 26) / 49) ** 2));
    const h3 = 24 * Math.exp(-(((x - 141) / 62) ** 2 + ((z + 17) / 36) ** 2));
    const hills = Math.max(h1, h2, h3) + Math.min(h1, h2) * 0.13;
    const detail = (fbm(x * 0.046 + 21, z * 0.046 - 31) - 0.47) * 8 + (noise(x * 0.14, z * 0.14) - 0.5) * 1.7;
    return inland * (0.155 + cliff * 0.13) + (hills + detail) * smooth(5, 46, inland);
  };

  const terrainSlope = (x: number, z: number) =>
    Math.hypot(terrainHeight(x + 1.5, z) - terrainHeight(x - 1.5, z), terrainHeight(x, z + 1.5) - terrainHeight(x, z - 1.5)) / 3;

  const rockiness = (x: number, z: number, h: number, slope: number) =>
    smooth(0.95, 1.9, slope) * (0.4 + 0.6 * smooth(35, -50, z)) * (0.5 + 0.5 * noise(x * 0.032, z * 0.032));

  const sand = new THREE.Color('#d4c8a7');
  const wetSand = new THREE.Color('#a99e7d');
  const forestFloor = new THREE.Color('#4b5b34');
  const rockColor = new THREE.Color('#8c8b7d');

  const colorAt = (x: number, z: number, h: number, slope: number, out: THREE.Color) => {
    const patch = fbm(x * 0.05, z * 0.05);
    const growth = smooth(2.8 + patch * 3.3, 7 + patch * 5, h);
    out.copy(sand).lerp(forestFloor, growth);
    out.lerp(rockColor, clamp(rockiness(x, z, h, slope), 0, 0.94) * smooth(2, 8, h));
    out.multiplyScalar(0.88 + patch * 0.23);
    if (h < 2) out.lerp(wetSand, (1 - smooth(0.15, 1.9, h)) * 0.22);
    if (h < -2) out.multiplyScalar(0.85 + 0.15 * noise(x * 0.07, z * 0.07));
    return out;
  };

  const seabedHeight = (x: number, z: number) => {
    let h = terrainHeight(x, z);
    const bx = Math.floor(x / 20),
      bz = Math.floor(z / 20);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = rockBuckets.get(`${bx + dx},${bz + dz}`);
        if (!bucket) continue;
        for (const r of bucket) {
          const rx = x - r.x,
            rz = z - r.z,
            c = Math.cos(r.rotation),
            s = Math.sin(r.rotation);
          const q = ((rx * c + rz * s) / r.sx) ** 2 + ((-rx * s + rz * c) / r.sz) ** 2;
          if (q < 1) h = Math.max(h, r.y + r.sy * Math.sqrt(1 - q));
        }
      }
    }
    return h;
  };

  const terrainSize = 1100;
  const terrainSegments = compact ? 320 : 432;
  const terrainGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
  terrainGeometry.rotateX(-Math.PI / 2);

  const positions = terrainGeometry.attributes.position;
  const terrainColors = new Float32Array(positions.count * 3);
  const sampleColor = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i),
      h = terrainHeight(x, z);
    positions.setY(i, h);
    colorAt(x, z, h, terrainSlope(x, z), sampleColor).toArray(terrainColors, i * 3);
  }
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();

  exportCausticLightingHelper();

  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    Object.assign(shader.uniforms, foamUniforms, skyUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainWorld = (modelMatrix * vec4(position, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vTerrainWorld;\n${noiseGLSL}\n${historyGLSL}\n${skyGLSL.replace('uStorm, ', '')}`);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
        #include <color_fragment>
        float groundFootprint = max(length(dFdx(vTerrainWorld.xz)), length(dFdy(vTerrainWorld.xz)));
        float groundDetail = mix(fractal(vTerrainWorld.xz * 0.57), 0.5, smoothstep(0.2, 1.2, groundFootprint));
        float grains = mix(noise2(vTerrainWorld.xz * 7.3), 0.5, smoothstep(0.025, 0.14, groundFootprint));
        diffuseColor.rgb *= 0.94 + groundDetail * 0.08 + grains * 0.025;
        vec4 washHistory = coastalHistory(vTerrainWorld.xz);
        float wetness = max(1.0 - smoothstep(-0.18, 0.02, vTerrainWorld.y), washHistory.a);
        float exposedSand = smoothstep(-0.16, 0.10, vTerrainWorld.y);
        float exposedWetness = wetness * exposedSand;
        diffuseColor.rgb *= 1.0 - wetness * 0.29;
        float washFilm = smoothstep(0.008, 0.075, washHistory.b) * smoothstep(-0.12, 0.08, vTerrainWorld.y);
        float washCells = fractal((vTerrainWorld.xz - uTime * vec2(0.17, 0.11)) * 1.9);
        float washLace = mix(smoothstep(0.33, 0.70, washCells), 0.53, smoothstep(0.08, 0.45, groundFootprint));
        float washFoam = clamp(washHistory.r * washFilm * mix(0.2, 1.0, mix(washLace, 1.0, washHistory.g * 0.7)), 0.0, 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.83, 0.79), washFoam);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(0.84, 0.95, exposedSand);
        roughnessFactor = mix(roughnessFactor, 0.24, exposedWetness);
        roughnessFactor = mix(roughnessFactor, 0.12, washFilm);
        roughnessFactor = mix(roughnessFactor, 0.8, washFoam);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `
        #include <normal_fragment_maps>
        float ripplePhase = dot(vTerrainWorld.xz, vec2(24.0, 18.3)) + fractal(vTerrainWorld.xz * 0.13) * 9.0;
        vec2 rippleGradient = vec2(dFdx(ripplePhase), dFdy(ripplePhase));
        float rippleFilter = exp(-0.7 * dot(rippleGradient, rippleGradient));
        float sandRipple = sin(ripplePhase) * 0.0045 * (0.35 + 0.65 * noise2(vTerrainWorld.xz * 0.11)) * rippleFilter * (1.0 - smoothstep(-0.5, 1.6, vTerrainWorld.y));
        float grit = fractal(vTerrainWorld.xz * 2.8) * 0.018 * exp(-pow(groundFootprint * 4.0, 2.0)) + sandRipple;
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec3 r0 = cross(q1, normal), r1 = cross(normal, q0);
        float determinant = dot(q0, r0);
        vec3 gradient = sign(determinant) * (dFdx(grit) * r0 + dFdy(grit) * r1);
        vec3 perturbedNormal = abs(determinant) * normal - gradient;
        float normalLengthSquared = dot(perturbedNormal, perturbedNormal);
        if (normalLengthSquared > 1e-16) normal = perturbedNormal * inversesqrt(normalLengthSquared);
      `
    );

    injectCausticLighting(shader, 'vTerrainWorld', causticUniforms, skyUniforms, compact);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      /* glsl */ `
        #include <lights_fragment_end>
        reflectedLight.directSpecular *= mix(0.08, 1.0, exposedSand);
        reflectedLight.indirectSpecular *= mix(0.08, 1.0, exposedSand);
        vec3 wetView = normalize(vViewPosition);
        vec3 wetNormal = inverseTransformDirection(normal, viewMatrix);
        vec3 wetWorldView = inverseTransformDirection(wetView, viewMatrix);
        vec3 wetReflection = reflect(-wetWorldView, wetNormal);
        float wetFresnel = 0.0204 + 0.9796 * pow(1.0 - clamp(dot(normal, wetView), 0.0, 1.0), 5.0);
        if (exposedWetness > 0.002) reflectedLight.indirectSpecular += atmosphereFiltered(wetReflection, mix(3.0, 0.9, exposedWetness)) * wetFresnel * exposedWetness * 0.82 * (1.0 - washFoam);
      `
    );
  };

  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  const mapResolution = 640;
  const heightData = new Uint16Array(mapResolution * mapResolution * 4);
  const bottomData = new Uint8Array(mapResolution * mapResolution * 4);
  for (let z = 0; z < mapResolution; z++) {
    for (let x = 0; x < mapResolution; x++) {
      const wx = ((x + 0.5) / mapResolution - 0.5) * terrainSize;
      const wz = ((z + 0.5) / mapResolution - 0.5) * terrainSize;
      const ground = terrainHeight(wx, wz);
      const bed = seabedHeight(wx, wz);
      const i = (z * mapResolution + x) * 4;
      heightData[i] = THREE.DataUtils.toHalfFloat(bed);
      heightData[i + 1] = THREE.DataUtils.toHalfFloat(ground);
      heightData[i + 2] = THREE.DataUtils.toHalfFloat(clamp((bed - ground) / 3, 0, 1));
      heightData[i + 3] = THREE.DataUtils.toHalfFloat(1);
      colorAt(wx, wz, ground, 0, sampleColor);
      if (bed > ground + 0.15) sampleColor.lerp(rockColor, 0.85);
      bottomData[i] = Math.round(clamp(sampleColor.r, 0, 1) * 255);
      bottomData[i + 1] = Math.round(clamp(sampleColor.g, 0, 1) * 255);
      bottomData[i + 2] = Math.round(clamp(sampleColor.b, 0, 1) * 255);
      bottomData[i + 3] = 255;
    }
  }

  const heightMap = new THREE.DataTexture(heightData, mapResolution, mapResolution, THREE.RGBAFormat, THREE.HalfFloatType);
  const bottomMap = new THREE.DataTexture(bottomData, mapResolution, mapResolution, THREE.RGBAFormat);
  for (const texture of [heightMap, bottomMap]) {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
  }

  return {
    terrain,
    terrainGeometry,
    terrainMaterial,
    heightMap,
    bottomMap,
    heightData,
    bottomData,
    terrainSize,
    mapResolution,
    terrainHeight,
    terrainSlope,
    coastDistance,
    rockiness,
    seabedHeight,
  };
}

export function injectCausticLighting(
  shader: THREE.WebGLProgramParametersWithUniforms,
  worldVarying: string,
  causticUniforms: { [key: string]: THREE.IUniform },
  skyUniforms: { [key: string]: THREE.IUniform },
  compact: boolean
) {
  Object.assign(shader.uniforms, causticUniforms, { uStorm: skyUniforms.uStorm });
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    /* glsl */ `
      #include <common>
      uniform sampler2D uCausticWide, uCausticDetail;
      uniform vec3 uCausticRegion;
      uniform float uStorm;
      uniform float uCausticDetailActive;
      float focusedSunlight(vec3 world) {
        if (world.y > 0.1 || world.y < -32.0) return 1.0;
        vec2 detailUV = (world.xz - uCausticRegion.xy) / uCausticRegion.z + vec2(0.5);
        float detailBlend = (1.0 - smoothstep(0.32, 0.47, max(abs(detailUV.x - 0.5), abs(detailUV.y - 0.5)))) * uCausticDetailActive;
        float receiverFootprint = max(length(dFdx(world.xz)), length(dFdy(world.xz)));
        float wideLOD = log2(max(1.0, max(-world.y * 0.35, receiverFootprint * ${compact ? '1024.0' : '1536.0'} / 760.0)));
        float fineLOD = log2(max(1.0, max(-world.y * 0.55, receiverFootprint * 1024.0 / 120.0)));
        float wide = textureLod(uCausticWide, world.xz / 760.0 + vec2(0.5), wideLOD).r;
        float fine = textureLod(uCausticDetail, detailUV, fineLOD).r;
        float concentration = mix(wide, fine, detailBlend);
        float submerged = (1.0 - smoothstep(-0.7, 0.05, world.y)) * exp(min(0.0, world.y) * 0.03) * (1.0 - smoothstep(13.0, 25.0, -world.y));
        float contrast = mix(1.0, 0.24, smoothstep(0.25, 1.8, receiverFootprint));
        return mix(1.0, clamp(0.48 + concentration * 0.58, 0.48, 3.2), submerged * contrast * (1.0 - uStorm * 0.98));
      }
    `
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>\nreflectedLight.directDiffuse *= focusedSunlight(${worldVarying});`
  );
}

function exportCausticLightingHelper() {}
