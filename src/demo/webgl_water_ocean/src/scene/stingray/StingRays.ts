import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Camera,
  Color,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector2,
  Vector3
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { seabedHeight } from '../environment/Seabed';
import { computeObstacleAvoidance, getRockElevation } from '../environment/Obstacles';

export interface StingRaysController {
  group: Group;
  update(
    time: number,
    delta: number,
    underwaterMix: number,
    causticTex: any,
    sunDirection: Vector3,
    fogColor?: Color,
    camera?: Camera | Vector3
  ): void;
}

interface RayAgent {
  root: Object3D;
  mixer: AnimationMixer | null;
  swimAction: AnimationAction | null;
  position: Vector3;
  heading: Vector3;
  velocity: Vector3;
  speed: number;
  baseSpeed: number;
  scale: number;
  hoverAltitude: number;
  phaseOffset: number;
  roamAngle: number;
  roamRadiusX: number;
  roamRadiusZ: number;
  roamCenter: Vector2;
  roamSpeed: number;
  bankRoll: number;
  pitch: number;
  turnDirection: number;
}

const UP_VECTOR = new Vector3(0, 1, 0);

export function createStingRays(scene: Scene, sunDirection: Vector3): StingRaysController {
  const stingRaysGroup = new Group();
  stingRaysGroup.name = 'StingRaysGroup';
  scene.add(stingRaysGroup);

  const stingRayUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection.clone() },
    uCausticTex: { value: null },
    uFogColor: { value: new Color(0x063542) },
  };

  function applyStingRayUnderwaterShading(mat: MeshStandardMaterial, key: string) {
    mat.customProgramCacheKey = () => `${key}_${mat.uuid}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = stingRayUniforms.uTime;
      shader.uniforms.uUnderwater = stingRayUniforms.uUnderwater;
      shader.uniforms.uSunDirection = stingRayUniforms.uSunDirection;
      shader.uniforms.uCausticTex = stingRayUniforms.uCausticTex;
      shader.uniforms.uFogColor = stingRayUniforms.uFogColor;

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
          #ifdef USE_SKINNING
            vCustomWorldNormal = normalize((modelMatrix * instanceMatrix * vec4(transformedNormal, 0.0)).xyz);
          #else
            vCustomWorldNormal = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz);
          #endif
        #else
          vCustomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #ifdef USE_SKINNING
            vCustomWorldNormal = normalize((modelMatrix * vec4(transformedNormal, 0.0)).xyz);
          #else
            vCustomWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
          #endif
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

        float rayHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float rayValueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(rayHash(i + vec2(0.0, 0.0)), rayHash(i + vec2(1.0, 0.0)), u.x),
            mix(rayHash(i + vec2(0.0, 1.0)), rayHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      ).replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        const float IOR_AIR = 1.0;
        const float IOR_WATER = 1.333;
        const vec3 underwaterColor = vec3(0.35, 0.85, 0.95);

        vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
        vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

        vec4 simCaust = texture2D(uCausticTex, causticCoord * 0.05 + 0.5);

        float cA = rayValueNoise(
          causticCoord * 0.85 + vec2(
            sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
            cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
          ) + vec2(uTime * 0.08, -uTime * 0.06)
        );
        float cB = rayValueNoise(causticCoord * 1.7 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08));
        float caustic = pow(cA, 1.6) * mix(0.20, 1.0, cB);
        float causticBreak = 0.25 + smoothstep(0.40, 0.75, rayValueNoise(causticCoord * 0.6 + vec2(uTime * 0.02, -uTime * 0.018))) * 0.75;
        caustic *= causticBreak;

        float totalCaust = caustic * 0.75 + simCaust.r * 1.5;
        float diffuseCaustic = max(0.0, dot(refractedLight, normalize(vCustomWorldNormal)));
        vec3 causticColor = underwaterColor * (totalCaust * 1.7) * (0.35 + diffuseCaustic * 0.65);
        gl_FragColor.rgb += causticColor * (0.45 + gl_FragColor.rgb * 0.55);

        // Depth-based visibility & tropical sea water extinction
        float viewDepth = length(vViewPosition);

        // Multi-spectral absorption in clear tropical water (Beer-Lambert Law)
        vec3 extinctionCoeffs = vec3(0.20, 0.075, 0.038);
        vec3 extinction = exp(-viewDepth * extinctionCoeffs);

        // Ocean inscattering haze & forward solar scattering
        vec3 viewDirection = normalize(vCustomWorldPosition - cameraPosition);
        float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);
        vec3 inscatterColor = uFogColor * (1.0 + pow(sunScatter, 5.0) * 0.45);

        // Apply chromatic absorption and inscattered ocean light
        gl_FragColor.rgb = gl_FragColor.rgb * extinction + inscatterColor * (1.0 - extinction.y);

        // Tropical sea water visibility distance fadeout (13m - 22m)
        float maxViewingDistance = 22.0;
        float fadeStartDistance = 13.0;
        float distanceAlpha = 1.0 - smoothstep(fadeStartDistance, maxViewingDistance, viewDepth);
        gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, distanceAlpha);
        `
      );
    };
  }

  // Small group of 4 sting rays roaming near the sea floor
  const RAY_COUNT = 4;
  const rays: RayAgent[] = [];
  const rayConfigs = [
    { scale: 0.52, hoverAlt: 0.32, speed: 0.95, roamRadiusX: 8.5, roamRadiusZ: 6.8, roamSpeed: 0.12, center: new Vector2(0.5, -1.0), phase: 0.0 },
    { scale: 0.46, hoverAlt: 0.45, speed: 1.05, roamRadiusX: 9.2, roamRadiusZ: 7.6, roamSpeed: 0.11, center: new Vector2(-2.2, 1.5), phase: 1.8 },
    { scale: 0.58, hoverAlt: 0.28, speed: 0.88, roamRadiusX: 11.0, roamRadiusZ: 8.5, roamSpeed: 0.095, center: new Vector2(1.8, 2.2), phase: 3.4 },
    { scale: 0.42, hoverAlt: 0.38, speed: 1.12, roamRadiusX: 7.8, roamRadiusZ: 6.2, roamSpeed: 0.13, center: new Vector2(-1.0, -2.5), phase: 4.9 },
  ];

  for (let i = 0; i < RAY_COUNT; i++) {
    const cfg = rayConfigs[i];
    const initialAngle = cfg.phase;
    const initX = cfg.center.x + Math.cos(initialAngle) * cfg.roamRadiusX;
    const initZ = cfg.center.y + Math.sin(initialAngle) * cfg.roamRadiusZ;
    const floorY = seabedHeight(initX, initZ);

    rays.push({
      root: new Group(),
      mixer: null,
      swimAction: null,
      position: new Vector3(initX, floorY + cfg.hoverAlt, initZ),
      heading: new Vector3(-Math.sin(initialAngle), 0, Math.cos(initialAngle)).normalize(),
      velocity: new Vector3(),
      speed: cfg.speed,
      baseSpeed: cfg.speed,
      scale: cfg.scale,
      hoverAltitude: cfg.hoverAlt,
      phaseOffset: cfg.phase,
      roamAngle: initialAngle,
      roamRadiusX: cfg.roamRadiusX,
      roamRadiusZ: cfg.roamRadiusZ,
      roamCenter: cfg.center,
      roamSpeed: cfg.roamSpeed,
      bankRoll: 0,
      pitch: 0,
      turnDirection: 1,
    });
  }

  function initRayModel(gltf: any) {
    const templateScene = gltf.scene;
    const clip = gltf.animations?.[0] || null;

    rays.forEach((ray, index) => {
      const cloned = SkeletonUtils.clone(templateScene);
      cloned.scale.setScalar(ray.scale);

      cloned.traverse((child: any) => {
        if (child.isMesh && child.material) {
          const mat = child.material.clone() as MeshStandardMaterial;
          mat.roughness = 0.45;
          mat.metalness = 0.15;
          applyStingRayUnderwaterShading(mat, `stingray_mat_${index}`);
          child.material = mat;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      ray.root.add(cloned);
      stingRaysGroup.add(ray.root);

      if (clip) {
        const mixer = new AnimationMixer(cloned);
        const action = mixer.clipAction(clip);
        action.setEffectiveTimeScale(0.85 + Math.random() * 0.3);
        action.play();
        // Stagger animation phases so they don't flap wings in identical sync
        action.time = Math.random() * (clip.duration || 2.0);
        ray.mixer = mixer;
        ray.swimAction = action;
      }
    });
  }

  // Load sting ray GLB model with fallbacks
  const loader = new GLTFLoader().setPath('assets/sting_ray/');
  loader.load(
    'sting_ray_swimming.glb',
    (gltf) => {
      initRayModel(gltf);
    },
    undefined,
    () => {
      const fallbackLoader = new GLTFLoader().setPath('/src/demo/webgl_water_ocean/assets/sting_ray/');
      fallbackLoader.load(
        'sting_ray_swimming.glb',
        (gltf) => {
          initRayModel(gltf);
        },
        undefined,
        () => {
          const fallbackLoader2 = new GLTFLoader().setPath('/src/demo/beautiful_water/assets/sting_ray/');
          fallbackLoader2.load(
            'sting_ray_swimming.glb',
            (gltf) => {
              initRayModel(gltf);
            },
            undefined,
            (err) => {
              console.error('Failed to load sting_ray_swimming.glb:', err);
            }
          );
        }
      );
    }
  );

  return {
    group: stingRaysGroup,
    update(time, delta, underwaterMix, causticTex, sunDir, fogColor, camera) {
      const safeDelta = Math.min(delta, 0.05);
      stingRayUniforms.uTime.value = time;
      stingRayUniforms.uUnderwater.value = underwaterMix;
      stingRayUniforms.uSunDirection.value.copy(sunDir);
      stingRayUniforms.uCausticTex.value = causticTex;
      if (fogColor) {
        stingRayUniforms.uFogColor.value.copy(fogColor);
      }

      rays.forEach((ray, i) => {
        // Update skeletal swim animation
        if (ray.mixer) {
          ray.mixer.update(safeDelta);
        }

        // Advance roaming trajectory
        ray.roamAngle += ray.roamSpeed * safeDelta;
        const lookAheadAngle = ray.roamAngle + 0.35;

        // Elliptical path with slight organic wave perturbation
        const wanderX = Math.sin(time * 0.25 + ray.phaseOffset) * 1.2;
        const wanderZ = Math.cos(time * 0.22 + ray.phaseOffset * 1.3) * 1.2;

        const targetX = ray.roamCenter.x + Math.cos(ray.roamAngle) * ray.roamRadiusX + wanderX;
        const targetZ = ray.roamCenter.y + Math.sin(ray.roamAngle) * ray.roamRadiusZ + wanderZ;

        const lookAheadX = ray.roamCenter.x + Math.cos(lookAheadAngle) * ray.roamRadiusX + wanderX;
        const lookAheadZ = ray.roamCenter.y + Math.sin(lookAheadAngle) * ray.roamRadiusZ + wanderZ;

        // Desired horizontal heading vector
        const desiredHeading2D = new Vector2(lookAheadX - ray.position.x, lookAheadZ - ray.position.z);
        if (desiredHeading2D.lengthSq() > 0.001) {
          desiredHeading2D.normalize();
        }

        // Calculate obstacle avoidance forces for kelp stalks only (stones are glided over elegantly)
        const rayRadius = 0.45 * (ray.scale / 0.5);
        const kelpAvoidance = computeObstacleAvoidance(
          ray.position.x,
          ray.position.y,
          ray.position.z,
          ray.heading.x,
          ray.heading.z,
          rayRadius,
          2.6,  // Lookahead distance
          0.30, // Safety margin
          0.20, // Vertical padding
          'kelp'
        );

        // Blend kelp avoidance steering into desired heading
        if (kelpAvoidance.isObstructed) {
          const steerVec = new Vector2(kelpAvoidance.steerX, kelpAvoidance.steerZ);
          desiredHeading2D.add(steerVec.multiplyScalar(2.2));
          if (desiredHeading2D.lengthSq() > 0.001) {
            desiredHeading2D.normalize();
          }
        }

        // Steer current heading smoothly towards target heading (gentle angular turn rate)
        const currentAngle = Math.atan2(ray.heading.x, ray.heading.z);
        const targetAngle = Math.atan2(desiredHeading2D.x, desiredHeading2D.y);

        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const baseTurnRate = 0.65;
        const maxTurnRate = (kelpAvoidance.isObstructed ? 0.95 : baseTurnRate) * safeDelta;
        const turnStep = MathUtils.clamp(angleDiff, -maxTurnRate, maxTurnRate);
        const newAngle = currentAngle + turnStep;

        ray.heading.set(Math.sin(newAngle), 0, Math.cos(newAngle)).normalize();

        // Soft flocking separation between sting rays
        for (let j = 0; j < rays.length; j++) {
          if (i !== j) {
            const other = rays[j];
            const dist = ray.position.distanceTo(other.position);
            if (dist < 2.0 && dist > 0.01) {
              const repel = new Vector3().subVectors(ray.position, other.position).normalize();
              ray.heading.addScaledVector(repel, (2.0 - dist) * 0.35 * safeDelta).normalize();
            }
          }
        }

        // Move forward along heading
        const moveDist = ray.speed * safeDelta;
        ray.position.x += ray.heading.x * moveDist;
        ray.position.z += ray.heading.z * moveDist;

        // Apply kelp proximity pushout if overlapping with dense stalks
        if (kelpAvoidance.pushX !== 0 || kelpAvoidance.pushZ !== 0) {
          ray.position.x += kelpAvoidance.pushX * 1.5 * safeDelta;
          ray.position.z += kelpAvoidance.pushZ * 1.5 * safeDelta;
        }

        // Low-level terrain following near the sea floor + smooth elevation glide over stones
        const floorHeightAtPos = seabedHeight(ray.position.x, ray.position.z);
        const rockElevationAtPos = getRockElevation(ray.position.x, ray.position.z, 0.35);

        // Lookahead terrain and rock height for pitch alignment (banking up/down over rock contours)
        const lookaheadFloor = seabedHeight(
          ray.position.x + ray.heading.x * 1.4,
          ray.position.z + ray.heading.z * 1.4
        );
        const lookaheadRock = getRockElevation(
          ray.position.x + ray.heading.x * 1.4,
          ray.position.z + ray.heading.z * 1.4,
          0.35
        );

        const currentSurfaceHeight = floorHeightAtPos + rockElevationAtPos;
        const aheadSurfaceHeight = lookaheadFloor + lookaheadRock;

        // Gentle altitude undulation (subtle breathing/swimming wave) + smooth stone gliding clearance
        const verticalBob = Math.sin(time * 1.4 + ray.phaseOffset) * 0.06;
        const targetAltitude = currentSurfaceHeight + ray.hoverAltitude + verticalBob;

        // Smoothly interpolate altitude with responsive elevation glide over stone mounds
        const altitudeDampRate = rockElevationAtPos > 0.1 ? 5.5 : 3.5;
        ray.position.y = MathUtils.damp(ray.position.y, targetAltitude, altitudeDampRate, safeDelta);

        // Calculate pitch based on seabed and stone slope along heading (gliding up and over rocks)
        const slopeDy = aheadSurfaceHeight - currentSurfaceHeight;
        const targetPitch = MathUtils.clamp(-slopeDy * 0.42, -0.35, 0.35);
        ray.pitch = MathUtils.damp(ray.pitch, targetPitch, 4.5, safeDelta);

        // Calculate hydrodynamic banking roll into turns
        // When turning right (turnStep > 0), bank right (roll); when turning left, bank left
        const targetRoll = MathUtils.clamp(-turnStep * 18.0, -0.45, 0.45);
        ray.bankRoll = MathUtils.damp(ray.bankRoll, targetRoll, 3.0, safeDelta);

        // Apply position and orientation to ray root
        ray.root.position.copy(ray.position);

        // Build orientation quaternion from Yaw (heading), Pitch (slope), and Roll (banking)
        const yaw = Math.atan2(ray.heading.x, ray.heading.z);
        const euler = new Euler(ray.pitch, yaw, ray.bankRoll, 'YXZ');
        ray.root.quaternion.setFromEuler(euler);
      });
    },
  };
}
