import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DataTexture,
  DirectionalLight,
  DodecahedronGeometry,
  Float32BufferAttribute,
  HemisphereLight,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3
} from 'three';

const SEABED_SIZE = 420;

export function seabedHeight(x: number, z: number): number {
  return -3.55
    + Math.sin(x * 0.105 + z * 0.035) * 0.17
    + Math.sin(z * 0.17 - x * 0.045) * 0.10
    + Math.sin((x + z) * 0.29) * 0.035;
}

function createParticleTexture(): CanvasTexture {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 32;
  textureCanvas.height = 32;

  const context = textureCanvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(210,255,250,0.95)');
    gradient.addColorStop(0.28, 'rgba(116,223,225,0.72)');
    gradient.addColorStop(1, 'rgba(80,190,205,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
  }

  const texture = new CanvasTexture(textureCanvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export interface EnvironmentOptions {
  shadowMapResolution?: number;
}

export interface EnvironmentController {
  underwaterObjects: Object3D[];
  requestShadowUpdate(): void;
  setShadowMapResolution(resolution: number): void;
  getDiagnostics(): any;
  update(time: number, underwaterMix: number): void;
}

export function createEnvironment(
  scene: Scene,
  sunDirection: Vector3,
  { shadowMapResolution = 2048 }: EnvironmentOptions = {},
): EnvironmentController {
  const seabedUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uUnderwater: { value: 0 },
  };

  const seabedMaterial = new ShaderMaterial({
    uniforms: seabedUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform float uUnderwater;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
          f.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);

        for (int i = 0; i < 2; i++) {
          value += amplitude * valueNoise(p);
          p = rotation * p * 2.04 + 9.2;
          amplitude *= 0.5;
        }

        return value;
      }

      void main() {
        vec2 p = vWorldPosition.xz;
        float broadSand = fbm(p * 0.065 + vec2(4.2, -1.7));
        float rippleA = sin(p.x * 1.85 + p.y * 0.42 + broadSand * 2.4);
        float rippleB = sin(p.x * -0.65 + p.y * 1.72 - broadSand * 1.8);
        float ripples = (rippleA * 0.62 + rippleB * 0.38) * 0.5 + 0.5;
        float fineSand = valueNoise(p * 5.4 + vec2(-7.8, 12.3));

        vec3 sandDeep = vec3(0.045, 0.25, 0.26);
        vec3 sandMid = vec3(0.10, 0.42, 0.39);
        vec3 sandLight = vec3(0.22, 0.62, 0.55);
        vec3 color = mix(sandDeep, sandMid, broadSand);
        color = mix(color, sandLight, ripples * 0.36 + fineSand * 0.18);

        // Snell's Law refraction and caustic projection (threejs_water_shark)
        const float IOR_AIR = 1.0;
        const float IOR_WATER = 1.333;
        const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
        vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
        vec2 causticCoord = (vWorldPosition.xz - vWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

        float causticA = valueNoise(
          causticCoord * 0.82 + vec2(
            sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
            cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
          ) + vec2(uTime * 0.08, -uTime * 0.06)
        );
        float causticB = valueNoise(
          causticCoord * 1.65 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08)
        );
        float caustic = pow(causticA, 1.55) * mix(0.18, 1.0, causticB);
        float causticBreakup = 0.22 + smoothstep(0.43, 0.73, valueNoise(
          causticCoord * 0.63 + vec2(uTime * 0.024, -uTime * 0.019)
        )) * 0.78;
        caustic *= causticBreakup;
        float diffuse = 0.45 + max(dot(normalize(vWorldNormal), refractedLight), 0.0) * 0.55;
        color *= diffuse;
        color += underwaterColor * (caustic * 0.85);

        float distanceToCamera = length(cameraPosition - vWorldPosition);
        vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
        float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);
        vec3 waterHaze = mix(
          vec3(0.008, 0.12, 0.15),
          vec3(0.04, 0.28, 0.32),
          pow(sunScatter, 3.0) * 0.50 + 0.15
        );
        vec3 extinction = exp(-distanceToCamera * vec3(0.16, 0.08, 0.055));
        vec3 underwaterShaded = color * extinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - extinction);
        color = mix(color, underwaterShaded, uUnderwater);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const seabedGeometry = new PlaneGeometry(
    SEABED_SIZE,
    SEABED_SIZE,
    60,
    60,
  );
  seabedGeometry.rotateX(-Math.PI / 2);
  const seabedPositions = seabedGeometry.attributes.position;
  for (let index = 0; index < seabedPositions.count; index += 1) {
    const x = seabedPositions.getX(index);
    const z = seabedPositions.getZ(index);
    seabedPositions.setY(index, seabedHeight(x, z));
  }
  seabedPositions.needsUpdate = true;
  seabedGeometry.computeVertexNormals();

  const seabed = new Mesh(seabedGeometry, seabedMaterial);
  seabed.receiveShadow = false;
  scene.add(seabed);

  let randomState = 0x7f4a7c15;
  function seededRandom() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  const applyBeerLambertFog = (mat: MeshStandardMaterial, cacheKey: string) => {
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uTime = seabedUniforms.uTime;
      shader.uniforms.uUnderwater = seabedUniforms.uUnderwater;
      shader.uniforms.uSunDirection = seabedUniforms.uSunDirection;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCustomWorldPosition;
        varying vec3 vCustomWorldNormal;`
      ).replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vCustomWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vCustomWorldNormal = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz);
        #else
          vCustomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vCustomWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
        #endif`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCustomWorldPosition;
        varying vec3 vCustomWorldNormal;
        uniform float uTime;
        uniform float uUnderwater;
        uniform vec3 uSunDirection;

        float envHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float envValueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(envHash(i + vec2(0.0, 0.0)), envHash(i + vec2(1.0, 0.0)), u.x),
            mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      ).replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          // Snell's Law refraction and caustic projection (threejs_water_shark)
          const float IOR_AIR = 1.0;
          const float IOR_WATER = 1.333;
          const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
          vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
          vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

          float cA = envValueNoise(
            causticCoord * 0.82 + vec2(
              sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
              cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
            ) + vec2(uTime * 0.08, -uTime * 0.06)
          );
          float cB = envValueNoise(
            causticCoord * 1.65 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08)
          );
          float caustic = pow(cA, 1.55) * mix(0.18, 1.0, cB);
          float causticBreak = 0.22 + smoothstep(0.43, 0.73, envValueNoise(
            causticCoord * 0.63 + vec2(uTime * 0.024, -uTime * 0.019)
          )) * 0.78;
          caustic *= causticBreak;

          float diffuseCaustic = max(0.0, dot(refractedLight, normalize(vCustomWorldNormal)));
          float depthFade = clamp(1.0 - (-vCustomWorldPosition.y * 0.06), 0.35, 1.0);
          vec3 causticColor = underwaterColor * (caustic * 1.85) * (0.35 + diffuseCaustic * 0.65) * depthFade;
          outgoingLight += causticColor * (0.45 + outgoingLight * 0.75);

          float distanceToCamera = length(cameraPosition - vCustomWorldPosition);
          vec3 viewDirection = normalize(vCustomWorldPosition - cameraPosition);
          float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);

          vec3 waterHaze = mix(
            vec3(0.008, 0.12, 0.15),
            vec3(0.04, 0.28, 0.32),
            pow(sunScatter, 3.0) * 0.50 + 0.15
          );

          vec3 extinction = exp(-distanceToCamera * vec3(0.16, 0.08, 0.055));
          float depthBelowSurface = max(0.0, -vCustomWorldPosition.y);
          vec3 depthExtinction = exp(-depthBelowSurface * vec3(0.035, 0.012, 0.006));

          vec3 underwaterShaded = outgoingLight * depthExtinction * extinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - extinction);
          outgoingLight = mix(outgoingLight, underwaterShaded, uUnderwater);
        #endif`
      );
    };
    mat.needsUpdate = true;
  };

  const rockCount = 34;
  const rockGeometry = new DodecahedronGeometry(0.72, 1);
  const rockMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.04,
    emissive: 0x082b2d,
    emissiveIntensity: 0.35,
  });
  applyBeerLambertFog(rockMaterial, 'rock_beer_lambert_fog');
  const rocks = new InstancedMesh(rockGeometry, rockMaterial, rockCount);
  const instanceTransform = new Object3D();
  const rockColor = new Color();
  for (let index = 0; index < rockCount; index += 1) {
    const angle = seededRandom() * Math.PI * 2;
    const radius = 4.0 + Math.sqrt(seededRandom()) * 34.0;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const scale = 0.28 + seededRandom() * 0.82;
    instanceTransform.position.set(x, seabedHeight(x, z) + scale * 0.34, z);
    instanceTransform.rotation.set(
      seededRandom() * 0.55,
      seededRandom() * Math.PI * 2,
      seededRandom() * 0.55,
    );
    instanceTransform.scale.set(
      scale * (0.75 + seededRandom() * 0.55),
      scale * (0.52 + seededRandom() * 0.42),
      scale * (0.76 + seededRandom() * 0.48),
    );
    instanceTransform.updateMatrix();
    rocks.setMatrixAt(index, instanceTransform.matrix);
    rockColor.setHSL(0.48 + seededRandom() * 0.06, 0.26, 0.38 + seededRandom() * 0.16);
    rocks.setColorAt(index, rockColor);
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);

  const grassCount = 150;
  const grassGeometry = new ConeGeometry(0.075, 1, 5, 1, true);
  const grassMaterial = new MeshStandardMaterial({
    color: 0x0f695f,
    roughness: 0.72,
    metalness: 0,
    side: 2, // DoubleSide
  });
  applyBeerLambertFog(grassMaterial, 'grass_beer_lambert_fog');
  const grass = new InstancedMesh(grassGeometry, grassMaterial, grassCount);
  const grassClusters = [
    new Vector2(-7, -6),
    new Vector2(8, -4),
    new Vector2(-11, 8),
    new Vector2(13, 10),
    new Vector2(2, 14),
    new Vector2(18, -13),
    new Vector2(-20, -12),
  ];
  for (let index = 0; index < grassCount; index += 1) {
    const cluster = grassClusters[Math.floor(seededRandom() * grassClusters.length)];
    const angle = seededRandom() * Math.PI * 2;
    const radius = Math.pow(seededRandom(), 1.7) * 2.4;
    const x = cluster.x + Math.cos(angle) * radius;
    const z = cluster.y + Math.sin(angle) * radius;
    const height = 0.38 + seededRandom() * 1.18;
    instanceTransform.position.set(x, seabedHeight(x, z) + height * 0.5, z);
    instanceTransform.rotation.set(
      (seededRandom() - 0.5) * 0.16,
      seededRandom() * Math.PI * 2,
      (seededRandom() - 0.5) * 0.16,
    );
    instanceTransform.scale.set(0.68 + seededRandom() * 0.72, height, 0.68 + seededRandom() * 0.72);
    instanceTransform.updateMatrix();
    grass.setMatrixAt(index, instanceTransform.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;
  grass.receiveShadow = true;
  scene.add(grass);

  const particleCount = 440;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const angle = seededRandom() * Math.PI * 2;
    const radius = Math.sqrt(seededRandom()) * 56;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = -12 + seededRandom() * 13.2;
    particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const particleGeometry = new BufferGeometry();
  particleGeometry.setAttribute('position', new BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array(particleCount * 2).fill(0.5), 2),
  );
  const particleMaterial = new PointsMaterial({
    map: createParticleTexture(),
    color: 0x70d9dd,
    size: 0.065,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    alphaTest: 0.015,
    blending: 2, // AdditiveBlending
  });
  const underwaterParticles = new Points(particleGeometry, particleMaterial);
  underwaterParticles.frustumCulled = false;
  underwaterParticles.renderOrder = 4;
  scene.add(underwaterParticles);

  const hemisphereLight = new HemisphereLight(0x9ad7ff, 0x06373f, 1.65);
  scene.add(hemisphereLight);

  const sunLight = new DirectionalLight(0xffe2bc, 3.6);
  sunLight.position.copy(sunDirection).multiplyScalar(36);
  sunLight.castShadow = true;
  let currentShadowMapResolution = shadowMapResolution;
  sunLight.shadow.mapSize.set(shadowMapResolution, shadowMapResolution);
  sunLight.shadow.camera.left = -20;
  sunLight.shadow.camera.right = 20;
  sunLight.shadow.camera.top = 20;
  sunLight.shadow.camera.bottom = -20;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 80;
  sunLight.shadow.bias = -0.00035;
  scene.add(sunLight);

  return {
    underwaterObjects: [seabed, rocks, grass],
    requestShadowUpdate() {
      sunLight.shadow.needsUpdate = true;
    },
    setShadowMapResolution(resolution: number) {
      const nextResolution = Math.max(512, Math.round(resolution));
      if (nextResolution === currentShadowMapResolution) return;
      currentShadowMapResolution = nextResolution;
      sunLight.shadow.mapSize.set(nextResolution, nextResolution);
      sunLight.shadow.map?.dispose();
      sunLight.shadow.map = null;
    },
    getDiagnostics() {
      return {
        shadowMapResolution: currentShadowMapResolution,
        shadowAutoUpdate: sunLight.shadow.autoUpdate,
      };
    },
    update(time: number, underwaterMix: number) {
      seabedUniforms.uTime.value = time;
      seabedUniforms.uUnderwater.value = underwaterMix;
      const underwaterHemisphere = 1.45;
      const underwaterSun = 2.2;
      hemisphereLight.intensity = MathUtils.lerp(
        1.65,
        underwaterHemisphere,
        underwaterMix,
      );
      sunLight.intensity = MathUtils.lerp(3.6, underwaterSun, underwaterMix);
      underwaterParticles.position.y = (time * 0.08) % 1.2;
      particleMaterial.opacity = MathUtils.lerp(0.0, 0.80, underwaterMix);
    },
  };
}
