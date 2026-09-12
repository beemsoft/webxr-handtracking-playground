import * as THREE from 'three';
import { noiseGLSL } from '../ocean/NoiseGLSL';

export interface FoliageResult {
  canopyMeshes: THREE.InstancedMesh[];
  branchMeshes: THREE.InstancedMesh[];
  trunkMesh: THREE.InstancedMesh;
  palmFronds: THREE.InstancedMesh;
  palmTrunks: THREE.InstancedMesh;
  groundCover: THREE.InstancedMesh;
  trees: Array<Array<{ x: number; y: number; z: number; height: number; radius: number; angle: number; color: THREE.Color }>>;
  palmItems: Array<{ x: number; y: number; z: number; scale: number; angle: number }>;
}

export function createFoliage(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  terrainHeight: (x: number, z: number) => number,
  terrainSlope: (x: number, z: number) => number,
  rockiness: (x: number, z: number, h: number, slope: number) => number,
  timeUniform: { value: number },
  skyUniforms: { [key: string]: THREE.IUniform },
  enableShadows: boolean = true
): FoliageResult {
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
  const fbm = (x: number, z: number) =>
    noise(x, z) * 0.56 +
    noise(x * 2.03 + 23.1, z * 2.03 - 17.7) * 0.28 +
    noise(x * 4.11 - 9.2, z * 4.11 + 31.4) * 0.16;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const smooth = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const finishGeometry = (vertices: number[], colors?: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  };

  const triangle = (out: number[], a: number[], b: number[], c: number[]) => {
    out.push(...a, ...b, ...c);
  };

  const leaf = (out: number[], start: number[], tip: number[], width: number, bend = 0.1) => {
    const mid = [(start[0] + tip[0]) * 0.5, (start[1] + tip[1]) * 0.5 + bend, (start[2] + tip[2]) * 0.5];
    const dx = tip[0] - start[0],
      dz = tip[2] - start[2],
      len = Math.hypot(dx, dz) || 1;
    const left = [mid[0] - (dz / len) * width, mid[1] - width * 0.25, mid[2] + (dx / len) * width];
    const right = [mid[0] + (dz / len) * width, mid[1] - width * 0.25, mid[2] - (dx / len) * width];
    triangle(out, start, left, mid);
    triangle(out, start, mid, right);
    triangle(out, left, tip, mid);
    triangle(out, mid, tip, right);
  };

  const makeLeafTexture = (variant: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);

    const drawLeaf = (x: number, y: number, angle: number, length: number, width: number, brightness: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      const gradient = ctx.createLinearGradient(0, -width, 0, width);
      gradient.addColorStop(0, `rgb(${brightness}, ${brightness}, ${brightness})`);
      gradient.addColorStop(0.48, `rgb(${brightness * 0.88}, ${brightness * 0.90}, ${brightness * 0.83})`);
      gradient.addColorStop(1, `rgb(${brightness * 0.65}, ${brightness * 0.71}, ${brightness * 0.60})`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(length * 0.2, -width, length * 0.72, -width, length, 0);
      ctx.bezierCurveTo(length * 0.68, width * 0.85, length * 0.18, width, 0, 0);
      ctx.fill();
      ctx.strokeStyle = `rgb(${brightness * 0.75}, ${brightness * 0.78}, ${brightness * 0.67})`;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(length * 0.92, 0);
      ctx.stroke();
      ctx.restore();
    };

    for (let branch = 0; branch < 22; branch++) {
      const angle = branch * 2.399963 + variant * 0.38,
        length = 110 + random() * 110;
      const baseX = 256 + (random() - 0.5) * 76,
        baseY = 256 + (random() - 0.5) * 76;
      const dx = Math.cos(angle),
        dy = Math.sin(angle);
      ctx.strokeStyle = '#817e68';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(
        baseX + dx * length * 0.5 - dy * 16,
        baseY + dy * length * 0.5 + dx * 16,
        baseX + dx * length,
        baseY + dy * length
      );
      ctx.stroke();
      for (let j = 1; j <= 11; j++) {
        const t = j / 12,
          x = baseX + dx * length * t - dy * Math.sin(t * Math.PI) * 8,
          y = baseY + dy * length * t + dx * Math.sin(t * Math.PI) * 8;
        for (const side of [-1, 1]) {
          drawLeaf(x, y, angle + side * (1.03 + random() * 0.5), 22 + random() * 20, 8 + random() * 7, 180 + random() * 73);
        }
      }
      drawLeaf(baseX + dx * length, baseY + dy * length, angle, 25, 8, 205 + random() * 40);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };

  const makeCrown = (variant: number) => {
    const verts: number[] = [],
      cols: number[] = [],
      uvs: number[] = [],
      wood: number[] = [],
      woodNormals: number[] = [],
      growingTips: THREE.Vector3[] = [];

    const tube = (
      start: THREE.Vector3,
      control: THREE.Vector3,
      end: THREE.Vector3,
      baseRadius: number,
      tipRadius: number,
      sides: number,
      segments: number
    ) => {
      const curve = new THREE.QuadraticBezierCurve3(start, control, end);
      const ring = (t: number, angle: number) => {
        const tangent = curve.getTangent(t),
          reference = Math.abs(tangent.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const side = new THREE.Vector3().crossVectors(tangent, reference).normalize(),
          up = new THREE.Vector3().crossVectors(side, tangent).normalize();
        const normal = side.multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
        return {
          point: curve.getPoint(t).addScaledVector(normal, lerp(baseRadius, tipRadius, t)).toArray(),
          normal: normal.toArray(),
        };
      };
      const face = (a: any, b: any, c: any) => {
        triangle(wood, a.point, b.point, c.point);
        triangle(woodNormals, a.normal, b.normal, c.normal);
      };
      for (let j = 0; j < segments; j++) {
        for (let k = 0; k < sides; k++) {
          const a = ring(j / segments, (k / sides) * TAU),
            b = ring(j / segments, ((k + 1) / sides) * TAU),
            c = ring((j + 1) / segments, (k / sides) * TAU),
            d = ring((j + 1) / segments, ((k + 1) / sides) * TAU);
          face(a, c, b);
          face(b, c, d);
        }
      }
    };

    tube(new THREE.Vector3(0, -1.375, 0), new THREE.Vector3(-0.09, -0.4, 0.05), new THREE.Vector3(0.06, 0.58, -0.04), 0.075, 0.016, 8, 5);

    for (let branch = 0; branch < 5; branch++) {
      const angle = branch * 2.399963 + variant * 0.83;
      const reach = 0.58 + random() * 0.24,
        height = 0.02 + branch * 0.1 + random() * 0.15;
      const root = new THREE.Vector3(-0.02, -0.48 + branch * 0.15, 0.02);
      const elbow = new THREE.Vector3(Math.cos(angle) * reach * 0.43, height - 0.14, Math.sin(angle) * reach * 0.43);
      const end = new THREE.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach);
      tube(root, elbow, end, 0.023 - branch * 0.0018, 0.005, 6, 3);
      growingTips.push(end.clone());
      for (const side of [-1, 1]) {
        const forkAngle = angle + side * (0.35 + random() * 0.3),
          distance = reach + 0.18 + random() * 0.16;
        const tip = new THREE.Vector3(Math.cos(forkAngle) * distance, height + (random() - 0.3) * 0.3, Math.sin(forkAngle) * distance);
        const start = elbow.clone().lerp(end, 0.53),
          bend = start.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.07, 0));
        tube(start, bend, tip, 0.008, 0.002, 4, 2);
        growingTips.push(tip);
      }
    }

    const up = new THREE.Vector3(),
      right = new THREE.Vector3(),
      normal = new THREE.Vector3();
    growingTips.forEach((tip, index) => {
      for (let spray = 0; spray < 2; spray++) {
        const angle = index * 2.399963 + spray * 1.7;
        const center = tip.clone().add(new THREE.Vector3((random() - 0.5) * 0.2, (random() - 0.5) * 0.23, (random() - 0.5) * 0.2));
        normal.set((random() - 0.5) * 1.2, 0.45 + random() * 0.7, (random() - 0.5) * 1.2).normalize();
        right.set(Math.cos(angle), 0, Math.sin(angle));
        up.crossVectors(normal, right).normalize();
        right.crossVectors(up, normal).normalize();
        const size = 0.43 + random() * 0.26;
        const corners = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([x, y]) => center.clone().addScaledVector(right, x * size).addScaledVector(up, y * size).toArray());
        const middle = center.clone().addScaledVector(normal, size * 0.1).toArray();
        const tint = 0.82 + smooth(-0.3, 0.9, center.y) * 0.13 + random() * 0.08;
        for (let j = 0; j < 4; j++) {
          triangle(verts, corners[j], corners[(j + 1) % 4], middle);
          const cornersUV = [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ];
          uvs.push(...cornersUV[j], ...cornersUV[(j + 1) % 4], 0.5, 0.5);
          for (let k = 0; k < 3; k++) cols.push(tint, tint, tint);
        }
      }
    });

    const foliage = finishGeometry(verts, cols);
    const branches = finishGeometry(wood);
    foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    branches.setAttribute('normal', new THREE.Float32BufferAttribute(woodNormals, 3));
    return { foliage, branches };
  };

  const windMaterial = (material: THREE.Material, strength: number, palm = false) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.uniforms.uWind = skyUniforms.uWind;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\nuniform float uTime, uWind;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 anchor = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
        vec3 anchor = vec3(0.0);
        #endif
        float phase = dot(anchor.xz, vec2(0.087, 0.113));
        float gust = (sin(uTime * 0.63 + phase) + 0.36 * sin(uTime * 1.17 + phase * 1.93)) * uWind;
        float py = clamp(position.y / 12.0, 0.0, 1.2);
        float flex = ${palm ? 'py * py' : 'smoothstep(-0.6, 1.4, position.y)'};
        transformed.x += gust * flex * ${strength.toFixed(4)};
        transformed.z += sin(uTime * 0.49 + phase * 1.3) * flex * ${(strength * 0.53).toFixed(4)} * uWind;
      `
      );
    };
  };

  const foliagePalette = ['#637943', '#6e8448', '#526e3f', '#72884e', '#5c7945', '#819454'].map((c) => new THREE.Color(c));
  const trees: Array<Array<{ x: number; y: number; z: number; height: number; radius: number; angle: number; color: THREE.Color }>> = [
    [],
    [],
    [],
    [],
  ];
  const trunks: Array<{ x: number; y: number; z: number; height: number; radius: number; angle: number; color: THREE.Color }> = [];

  // Spread trees across the island
  for (let z = -68; z < 60; z += 4.5) {
    for (let x = -105; x < 118; x += 4.5) {
      const px = x + (random() - 0.5) * 4.2,
        pz = z + (random() - 0.5) * 4.2;
      const h = terrainHeight(px, pz);
      if (h < 1.3) continue;
      const slope = terrainSlope(px, pz);
      if (slope > 1.8) continue;
      const rock = rockiness(px, pz, h, slope);
      const patch = fbm(px * 0.054 + 51, pz * 0.054 - 18);
      const density = smooth(1.2, 4.0, h) * (0.45 + patch * 0.85) * (1 - smooth(0.55, 0.9, rock));
      if (random() > density) continue;
      const shrub = h < 2.6 || random() < 0.12;
      const height = shrub ? 0.7 + random() * 1.5 : 2.5 + (random() ** 0.7) * 3.6;
      const radius = shrub ? 0.9 + random() * 0.7 : 1.5 + random() * 1.0;
      const item = {
        x: px,
        z: pz,
        y: h,
        height,
        radius,
        angle: random() * TAU,
        color: foliagePalette[Math.floor(random() * foliagePalette.length)].clone().multiplyScalar(0.9 + random() * 0.2),
      };
      trees[Math.floor(random() * trees.length)].push(item);
      if (!shrub) trunks.push(item);
    }
  }

  const canopyMeshes: THREE.InstancedMesh[] = [];
  const branchMeshes: THREE.InstancedMesh[] = [];
  const branchMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e5e49,
    roughness: 0.94,
    side: THREE.DoubleSide,
  });
  windMaterial(branchMaterial, 0.042, false);

  trees.forEach((items, index) => {
    const model = makeCrown(index);
    const material = new THREE.MeshStandardMaterial({
      map: makeLeafTexture(index),
      vertexColors: true,
      roughness: 0.82,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    });
    windMaterial(material, 0.052, false);
    const mesh = new THREE.InstancedMesh(model.foliage, material, Math.max(1, items.length));
    const branches = new THREE.InstancedMesh(model.branches, branchMaterial, Math.max(1, items.length));
    items.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y + tree.height * 0.66, tree.z);
      dummy.rotation.set(0, tree.angle, (random() - 0.5) * 0.12);
      dummy.scale.set(tree.radius, tree.height * 0.48, tree.radius * (0.8 + random() * 0.3));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tree.color);
      branches.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = enableShadows;
    mesh.receiveShadow = enableShadows;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = items.length > 0;

    branches.castShadow = enableShadows;
    branches.receiveShadow = enableShadows;
    branches.frustumCulled = false;
    branches.instanceMatrix.needsUpdate = true;
    branches.visible = items.length > 0;

    canopyMeshes.push(mesh);
    branchMeshes.push(branches);
    scene.add(mesh, branches);
  });

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.22, 1, 7, 1).translate(0, 0.5, 0);
  const trunkMesh = new THREE.InstancedMesh(
    trunkGeometry,
    new THREE.MeshStandardMaterial({ color: 0x5c4d3c, roughness: 0.95 }),
    Math.max(1, trunks.length)
  );
  trunks.forEach((tree, i) => {
    dummy.position.set(tree.x, tree.y, tree.z);
    dummy.rotation.set(0, tree.angle, 0.035);
    dummy.scale.set(1, tree.height * 0.58, 1);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
  });
  trunkMesh.castShadow = enableShadows;
  trunkMesh.receiveShadow = enableShadows;
  trunkMesh.frustumCulled = false;
  trunkMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.visible = trunks.length > 0;
  scene.add(trunkMesh);

  const palmTrunkVertices: number[] = [],
    palmFrondVertices: number[] = [];
  const palmPath = (t: number) => [1.6 * t * t, 12 * t, 0.35 * Math.sin(t * Math.PI * 0.7)];

  for (let j = 0; j < 15; j++) {
    for (let k = 0; k < 8; k++) {
      const ringPoint = (row: number, col: number) => {
        const t = row / 15,
          p = palmPath(t),
          a = (col / 8) * TAU,
          radius = lerp(0.21, 0.105, t) * (1 + 0.07 * Math.sin(row * 2.8));
        return [p[0] + Math.cos(a) * radius, p[1], p[2] + Math.sin(a) * radius];
      };
      const a = ringPoint(j, k),
        b = ringPoint(j, k + 1),
        c = ringPoint(j + 1, k),
        d = ringPoint(j + 1, k + 1);
      triangle(palmTrunkVertices, a, c, b);
      triangle(palmTrunkVertices, b, c, d);
    }
  }

  const crownPoint = palmPath(1);
  for (let f = 0; f < 6; f++) {
    const a = (f / 6) * TAU + random() * 0.35,
      length = 4.4 + random() * 1.5,
      lift = 1.3 + random() * 1.4;
    const direction = [Math.cos(a), Math.sin(a)],
      side = [-direction[1], direction[0]];
    const path = (t: number) => [
      crownPoint[0] + direction[0] * length * t,
      12 + lift * Math.sin(t * Math.PI * 0.91) - 2.1 * t * t,
      crownPoint[2] + direction[1] * length * t,
    ];
    for (let j = 1; j < 13; j++) {
      const t = j / 13,
        p = path(t),
        p2 = path((j + 1) / 13);
      const wide = Math.sin(t * Math.PI) ** 0.65 * (1.0 + random() * 0.36);
      for (const sign of [-1, 1]) {
        const tip = [
          p[0] + side[0] * wide * sign + direction[0] * 0.48,
          p[1] - 0.28 - wide * 0.36,
          p[2] + side[1] * wide * sign + direction[1] * 0.48,
        ];
        leaf(palmFrondVertices, p, tip, 0.085 + random() * 0.025, 0.09);
      }
      triangle(
        palmFrondVertices,
        [p[0] - side[0] * 0.026, p[1] + 0.018, p[2] - side[1] * 0.026],
        [p[0] + side[0] * 0.026, p[1] + 0.018, p[2] + side[1] * 0.026],
        p2
      );
    }
  }

  const palmItems: Array<{ x: number; y: number; z: number; scale: number; angle: number }> = [];
  for (let attempt = 0; attempt < 2500 && palmItems.length < 45; attempt++) {
    const x = random() * 230 - 110,
      z = random() * 120 - 55,
      h = terrainHeight(x, z);
    if (h < 0.9 || h > 7.5 || terrainSlope(x, z) > 0.52) continue;
    if (noise(x * 0.068 + 7, z * 0.068) < 0.35 || (z < -15 && random() < 0.85)) continue;
    if (palmItems.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 18)) continue;
    palmItems.push({ x, z, y: h, scale: 0.5 + random() * 0.35, angle: random() * TAU });
  }

  const palmMaterial = new THREE.MeshStandardMaterial({ color: 0x487d32, roughness: 0.75, side: THREE.DoubleSide, vertexColors: true });
  windMaterial(palmMaterial, 0.2, true);
  const palmTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8b6d4e, roughness: 0.92 });
  windMaterial(palmTrunkMaterial, 0.12, true);
  const palmFronds = new THREE.InstancedMesh(finishGeometry(palmFrondVertices), palmMaterial, Math.max(1, palmItems.length));
  const palmTrunks = new THREE.InstancedMesh(finishGeometry(palmTrunkVertices), palmTrunkMaterial, Math.max(1, palmItems.length));

  palmItems.forEach((palm, i) => {
    dummy.position.set(palm.x, palm.y, palm.z);
    dummy.rotation.set((random() - 0.5) * 0.08, palm.angle, (random() - 0.5) * 0.09);
    dummy.scale.set(palm.scale, palm.scale * (0.9 + random() * 0.2), palm.scale);
    dummy.updateMatrix();
    palmFronds.setMatrixAt(i, dummy.matrix);
    palmTrunks.setMatrixAt(i, dummy.matrix);
    palmFronds.setColorAt(i, color.set('#566c31').lerp(new THREE.Color('#344c25'), random() * 0.65));
  });

  for (const mesh of [palmFronds, palmTrunks]) {
    mesh.castShadow = enableShadows;
    mesh.receiveShadow = enableShadows;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = palmItems.length > 0;
    scene.add(mesh);
  }

  const grassVertices: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + random() * 0.4,
      r = 0.2 + random() * 0.45;
    leaf(grassVertices, [0, 0, 0], [Math.cos(a) * r, 0.14 + random() * 0.32, Math.sin(a) * r], 0.04, 0.2);
  }

  const groundItems: Array<{ x: number; z: number; h: number }> = [];
  for (let attempt = 0; attempt < 3000 && groundItems.length < 350; attempt++) {
    const gx = random() * 200 - 100;
    const gz = random() * 110 - 55;
    const gh = terrainHeight(gx, gz);
    if (gh > 0.6 && gh < 12 && terrainSlope(gx, gz) < 0.7) {
      groundItems.push({ x: gx, z: gz, h: gh });
    }
  }
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x667348, roughness: 0.94, side: THREE.DoubleSide });
  windMaterial(groundMaterial, 0.085, false);
  const groundCover = new THREE.InstancedMesh(finishGeometry(grassVertices), groundMaterial, Math.max(1, groundItems.length));
  groundItems.forEach((item, i) => {
    dummy.position.set(item.x, item.h, item.z);
    dummy.rotation.set(0, random() * TAU, 0);
    dummy.scale.set(1.5, 1.5, 1.5);
    dummy.updateMatrix();
    groundCover.setMatrixAt(i, dummy.matrix);
  });
  groundCover.castShadow = false;
  groundCover.receiveShadow = enableShadows;
  groundCover.frustumCulled = false;
  groundCover.instanceMatrix.needsUpdate = true;
  groundCover.visible = groundItems.length > 0;
  scene.add(groundCover);

  return { canopyMeshes, branchMeshes, trunkMesh, palmFronds, palmTrunks, groundCover, trees, palmItems };
}
