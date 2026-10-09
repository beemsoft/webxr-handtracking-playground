import * as THREE from 'three';

// Sandy coastal bed geometry with realistic shoaling slope, pebble berm, and wetness transition.
export class Shorebed extends THREE.Mesh {
  constructor() {
    const nx = 80;
    const nz = 100;
    const xMin = -60, xMax = 60;
    const zMin = -60, zMax = 20;

    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uvs = new Float32Array((nx + 1) * (nz + 1) * 2);
    const indices: number[] = [];

    // Piecewise beach bed profile (matching ShoreBreak bathymetry)
    const bedHeight = (z: number) => {
      if (z < -20.0) {
        return -3.5 + (z + 20.0) * 0.12;
      } else if (z < -2.0) {
        return -0.8 + (z + 2.0) * 0.15;
      } else if (z < 4.0) {
        return (z) * 0.22;
      } else {
        return 0.88 + (z - 4.0) * 0.08;
      }
    };

    let pIdx = 0;
    let uvIdx = 0;

    for (let j = 0; j <= nz; j++) {
      const v = j / nz;
      const z = zMin + v * (zMax - zMin);
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const x = xMin + u * (xMax - xMin);

        // Add subtle natural beach dune ripple variations
        const noise = Math.sin(x * 0.2) * Math.cos(z * 0.3) * 0.05 + Math.sin(x * 0.7 + z * 0.5) * 0.02;
        const y = bedHeight(z) + noise;

        pos[pIdx++] = x;
        pos[pIdx++] = y;
        pos[pIdx++] = z;

        uvs[uvIdx++] = u * 20.0;
        uvs[uvIdx++] = v * 20.0;
      }
    }

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = (j + 1) * (nx + 1) + i;
        const c = j * (nx + 1) + (i + 1);
        const d = (j + 1) * (nx + 1) + (i + 1);

        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.ShaderMaterial({
      name: 'ShorebedMaterial',
      uniforms: {
        uSunDirection: { value: new THREE.Vector3(0.3, 0.9, -0.3).normalize() },
        uSandColorDry: { value: new THREE.Color(0xd7c49e) },
        uSandColorWet: { value: new THREE.Color(0x7c694a) },
        uWaterLevel: { value: 0.0 }
      },
      vertexShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;

        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec2 vUv;

        uniform vec3 uSunDirection;
        uniform vec3 uSandColorDry;
        uniform vec3 uSandColorWet;
        uniform float uWaterLevel;

        void main() {
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDirection);
          vec3 V = normalize(cameraPosition - vWorldPosition);

          float NdotL = max(dot(N, L), 0.15);
          
          // Wetness factor based on elevation relative to still water level + swash wash zone
          float wetness = 1.0 - smoothstep(-0.2, 0.6, vWorldPosition.y);
          
          vec3 sandBase = mix(uSandColorDry, uSandColorWet, wetness);
          
          // Subtle pebble/granule texture procedural variation
          float grain = fract(sin(dot(vUv * 5.0, vec2(12.9898, 78.233))) * 43758.5453);
          sandBase *= (0.92 + 0.16 * grain);

          // Specular wet sheen
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 32.0) * wetness * 0.4;

          vec3 finalColor = sandBase * NdotL + vec3(spec);
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    super(geometry, material);
    this.name = 'Shorebed';
    this.receiveShadow = true;
  }
}
