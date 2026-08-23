import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3
} from 'three';
import { generateSeabedObstacles } from './Obstacles';

const SEABED_SIZE = 220;

export function seabedHeight(x: number, z: number): number {
  return -3.85
    + Math.sin(x * 0.085 + z * 0.035) * 0.22
    + Math.sin(z * 0.12 - x * 0.045) * 0.14
    + Math.sin((x + z) * 0.22) * 0.04;
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

export interface SeabedController {
  seabed: Mesh;
  underwaterObjects: Object3D[];
  uniforms: { [key: string]: { value: any } };
  update(
    time: number,
    underwaterMix: number,
    waterTexture: any,
    causticTexture: any,
    sunDirection: Vector3,
    fogColor?: Color
  ): void;
}

export function createSeabed(scene: Scene, sunDirection: Vector3): SeabedController {
  const seabedUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uUnderwater: { value: 0 },
    uWater: { value: null },
    uCausticTex: { value: null },
    uFogColor: { value: new Color(0x063542) },
  };

  const seabedMaterial = new ShaderMaterial({
    uniforms: seabedUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec3 vViewPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = viewMatrix * worldPosition;
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      const float IOR_AIR = 1.0;
      const float IOR_WATER = 1.333;
      const vec3 underwaterColor = vec3(0.35, 0.85, 0.95);

      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform float uUnderwater;
      uniform sampler2D uWater;
      uniform sampler2D uCausticTex;
      uniform vec3 uFogColor;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec3 vViewPosition;

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

        // Sandy floor coloration (golden-cyan sandy palette)
        vec3 sandDeep = vec3(0.06, 0.28, 0.30);
        vec3 sandMid = vec3(0.18, 0.52, 0.48);
        vec3 sandLight = vec3(0.35, 0.72, 0.62);
        vec3 color = mix(sandDeep, sandMid, broadSand);
        color = mix(color, sandLight, ripples * 0.38 + fineSand * 0.16);

        // Snell's Law refraction and caustic projection
        vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
        vec2 causticCoord = (vWorldPosition.xz - vWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

        // GPU Water simulation caustics sampling
        vec4 simCaustic = texture2D(uCausticTex, causticCoord * 0.05 + 0.5);

        // Multi-octave wave caustics
        float cA = valueNoise(
          causticCoord * 0.85 + vec2(
            sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
            cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
          ) + vec2(uTime * 0.08, -uTime * 0.06)
        );
        float cB = valueNoise(causticCoord * 1.7 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08));
        float procCaustic = pow(cA, 1.6) * mix(0.20, 1.0, cB);
        float causticBreakup = 0.25 + smoothstep(0.40, 0.75, valueNoise(causticCoord * 0.6 + vec2(uTime * 0.02, -uTime * 0.018))) * 0.75;
        procCaustic *= causticBreakup;

        float totalCaustic = procCaustic * 0.75 + simCaustic.r * 1.5;

        float diffuse = 0.45 + max(dot(normalize(vWorldNormal), refractedLight), 0.0) * 0.55;
        color *= diffuse;
        color += underwaterColor * (totalCaustic * 0.95);

        // Depth-based visibility and tropical sea water extinction
        float viewDepth = length(vViewPosition);

        // Multi-spectral absorption in clear tropical water (Beer-Lambert Law)
        vec3 extinctionCoeffs = vec3(0.20, 0.075, 0.038);
        vec3 extinction = exp(-viewDepth * extinctionCoeffs);

        // Ocean inscattering haze & forward solar scattering
        vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
        float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);
        vec3 waterHaze = mix(
          uFogColor,
          vec3(0.08, 0.52, 0.62),
          pow(sunScatter, 3.0) * 0.40
        );

        // Plausible viewing distance fadeout in tropical sea water (fadeout between 13m and 22m)
        float maxViewDistance = 22.0;
        float visibilityFade = clamp(1.0 - smoothstep(13.0, maxViewDistance, viewDepth), 0.0, 1.0);
        vec3 effectiveExtinction = extinction * visibilityFade;

        vec3 underwaterShaded = color * effectiveExtinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - effectiveExtinction);
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
    80,
    80,
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
  seabed.name = 'OceanFloor';
  seabed.receiveShadow = false;
  scene.add(seabed);

  // Underwater environment decoration: Rocks, Kelp, Marine Snow
  const underwaterObjects: Object3D[] = [];

  const { rocks: obstacleRocks, kelp: obstacleKelp, nextRandomState } = generateSeabedObstacles();
  let randomState = nextRandomState;
  function seededRandom() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  const applyCausticsAnd10mFog = (mat: MeshStandardMaterial, cacheKey: string, isKelp = false) => {
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uTime = seabedUniforms.uTime;
      shader.uniforms.uUnderwater = seabedUniforms.uUnderwater;
      shader.uniforms.uSunDirection = seabedUniforms.uSunDirection;
      shader.uniforms.uCausticTex = seabedUniforms.uCausticTex;
      shader.uniforms.uFogColor = seabedUniforms.uFogColor;

      let kelpVertexDisplacement = '';
      if (isKelp) {
        kelpVertexDisplacement = `
          // Sea wavy animation for kelp vegetation
          // Base (transformed.y ~ 0) stays anchored, upper stem and tip sway with oceanic currents
          float kelpHeightNorm = clamp(transformed.y / 2.2, 0.0, 1.0);
          float kelpSwayFactor = kelpHeightNorm * kelpHeightNorm;

          // Instance world seed
          #ifdef USE_INSTANCING
            vec3 instWorldOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 instWorldOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif

          float kelpWaveA = sin(uTime * 1.35 + instWorldOrigin.x * 0.45 + instWorldOrigin.z * 0.35 + transformed.y * 0.85);
          float kelpWaveB = cos(uTime * 0.95 + instWorldOrigin.x * 0.25 - instWorldOrigin.z * 0.50 + transformed.y * 0.65);

          float swayX = kelpWaveA * 0.24 * kelpSwayFactor;
          float swayZ = kelpWaveB * 0.18 * kelpSwayFactor;

          transformed.x += swayX;
          transformed.z += swayZ;
        `;
      }

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vCustomWorldPosition;
        varying vec3 vCustomWorldNormal;`
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${kelpVertexDisplacement}`
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
        uniform sampler2D uCausticTex;
        uniform vec3 uFogColor;

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
          const float IOR_AIR = 1.0;
          const float IOR_WATER = 1.333;
          const vec3 underwaterColor = vec3(0.35, 0.85, 0.95);
          vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
          vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

          vec4 simCaust = texture2D(uCausticTex, causticCoord * 0.05 + 0.5);

          float cA = envValueNoise(
            causticCoord * 0.85 + vec2(
              sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
              cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
            ) + vec2(uTime * 0.08, -uTime * 0.06)
          );
          float cB = envValueNoise(causticCoord * 1.7 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08));
          float caustic = pow(cA, 1.6) * mix(0.20, 1.0, cB);
          float causticBreak = 0.25 + smoothstep(0.40, 0.75, envValueNoise(causticCoord * 0.6 + vec2(uTime * 0.02, -uTime * 0.018))) * 0.75;
          caustic *= causticBreak;

          float totalCaust = caustic * 0.75 + simCaust.r * 1.5;
          float diffuseCaustic = max(0.0, dot(refractedLight, normalize(vCustomWorldNormal)));
          vec3 causticColor = underwaterColor * (totalCaust * 1.6) * (0.35 + diffuseCaustic * 0.65);
          outgoingLight += causticColor * (0.4 + outgoingLight * 0.6);

          // Depth-based visibility & tropical sea water extinction
          float viewDepth = length(vViewPosition);

          // Multi-spectral absorption in clear tropical water (Beer-Lambert Law)
          vec3 extinctionCoeffs = vec3(0.20, 0.075, 0.038);
          vec3 extinction = exp(-viewDepth * extinctionCoeffs);

          // Ocean inscattering haze & forward solar scattering
          vec3 viewDirection = normalize(vCustomWorldPosition - cameraPosition);
          float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);
          vec3 waterHaze = mix(
            uFogColor,
            vec3(0.08, 0.52, 0.62),
            pow(sunScatter, 3.0) * 0.40
          );

          // Plausible viewing distance fadeout in tropical sea water (fadeout between 13m and 22m)
          float maxViewDistance = 22.0;
          float visibilityFade = clamp(1.0 - smoothstep(13.0, maxViewDistance, viewDepth), 0.0, 1.0);
          vec3 effectiveExtinction = extinction * visibilityFade;

          vec3 underwaterShaded = outgoingLight * effectiveExtinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - effectiveExtinction);
          outgoingLight = mix(outgoingLight, underwaterShaded, uUnderwater);
        #endif`
      );
    };
    mat.needsUpdate = true;
  };

  // Rocks
  const rockCount = obstacleRocks.length;
  const rockGeometry = new DodecahedronGeometry(0.75, 1);
  const rockMaterial = new MeshStandardMaterial({
    color: 0x5a6a68,
    roughness: 0.85,
    metalness: 0.05,
  });
  applyCausticsAnd10mFog(rockMaterial, 'rock_caustic_fog');

  const rockMesh = new InstancedMesh(rockGeometry, rockMaterial, rockCount);
  const rockDummy = new Object3D();
  for (let i = 0; i < rockCount; i++) {
    const rock = obstacleRocks[i];
    rockDummy.position.set(rock.x, rock.y, rock.z);
    rockDummy.rotation.set(rock.rotX, rock.rotY, rock.rotZ);
    rockDummy.scale.set(rock.scaleX, rock.scaleY, rock.scaleZ);
    rockDummy.updateMatrix();
    rockMesh.setMatrixAt(i, rockDummy.matrix);
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  scene.add(rockMesh);
  underwaterObjects.push(rockMesh);

  // Kelp vegetation
  const kelpCount = obstacleKelp.length;
  const kelpGeometry = new ConeGeometry(0.25, 2.2, 7, 20);
  kelpGeometry.translate(0, 1.1, 0);
  const kelpMaterial = new MeshStandardMaterial({
    color: 0x1f5c38,
    roughness: 0.65,
    metalness: 0.05,
  });
  applyCausticsAnd10mFog(kelpMaterial, 'kelp_caustic_fog', true);

  const kelpMesh = new InstancedMesh(kelpGeometry, kelpMaterial, kelpCount);
  const kelpDummy = new Object3D();
  for (let i = 0; i < kelpCount; i++) {
    const kelp = obstacleKelp[i];
    kelpDummy.position.set(kelp.x, kelp.y, kelp.z);
    kelpDummy.rotation.set(kelp.rotX, kelp.rotY, kelp.rotZ);
    kelpDummy.scale.set(kelp.scaleX, kelp.scaleY, kelp.scaleZ);
    kelpDummy.updateMatrix();
    kelpMesh.setMatrixAt(i, kelpDummy.matrix);
  }
  kelpMesh.instanceMatrix.needsUpdate = true;
  scene.add(kelpMesh);
  underwaterObjects.push(kelpMesh);

  // Marine snow particles
  const particleCount = 280;
  const particleGeometry = new BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const angle = seededRandom() * Math.PI * 2;
    const radius = 2.0 + seededRandom() * 18.0;
    particlePositions[i * 3] = Math.cos(angle) * radius;
    particlePositions[i * 3 + 1] = -0.3 - seededRandom() * 3.2;
    particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  particleGeometry.setAttribute('position', new BufferAttribute(particlePositions, 3));

  const particleMaterial = new ShaderMaterial({
    uniforms: {
      uTime: seabedUniforms.uTime,
      uUnderwater: seabedUniforms.uUnderwater,
      uFogColor: seabedUniforms.uFogColor,
      uPointTexture: { value: createParticleTexture() },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vViewPosition;

      void main() {
        vec3 pos = position;
        pos.y += sin(uTime * 0.8 + position.x * 2.0 + position.z * 2.0) * 0.05;
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        vViewPosition = -mvPosition.xyz;

        float dist = max(0.1, -mvPosition.z);
        gl_PointSize = clamp(18.0 / dist, 1.0, 24.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uPointTexture;
      uniform float uUnderwater;
      uniform vec3 uFogColor;
      varying vec3 vViewPosition;

      void main() {
        vec4 texColor = texture2D(uPointTexture, gl_PointCoord);
        if (texColor.a < 0.03) discard;

        float dist = length(vViewPosition);
        float visibility = clamp(1.0 - smoothstep(8.0, 20.0, dist), 0.0, 1.0);
        vec3 col = mix(uFogColor, vec3(0.72, 0.95, 0.92), visibility);

        gl_FragColor = vec4(col, texColor.a * visibility * uUnderwater * 0.75);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const marineSnow = new Points(particleGeometry, particleMaterial);
  scene.add(marineSnow);
  underwaterObjects.push(marineSnow);

  return {
    seabed,
    underwaterObjects,
    uniforms: seabedUniforms,
    update(
      time: number,
      underwaterMix: number,
      waterTexture: any,
      causticTexture: any,
      sunDirection: Vector3,
      fogColor?: Color
    ) {
      seabedUniforms.uTime.value = time;
      seabedUniforms.uUnderwater.value = underwaterMix;
      seabedUniforms.uWater.value = waterTexture;
      seabedUniforms.uCausticTex.value = causticTexture;
      seabedUniforms.uSunDirection.value.copy(sunDirection);
      if (fogColor) {
        seabedUniforms.uFogColor.value.copy(fogColor);
      }

      // Marine snow gentle floating animation
      const posAttr = particleGeometry.attributes.position as BufferAttribute;
      for (let i = 0; i < particleCount; i++) {
        let y = posAttr.getY(i) + Math.sin(time * 0.8 + i) * 0.003;
        if (y > -0.2) y = -3.4;
        if (y < -3.5) y = -0.3;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    },
  };
}
