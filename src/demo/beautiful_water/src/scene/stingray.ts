import {
  AnimationAction,
  AnimationMixer,
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
import { seabedHeight } from './environment';

export interface StingRaysController {
  group: Group;
  underwaterObjects: Object3D[];
  update: (
    delta: number,
    elapsedTime: number,
    underwaterMix: number,
    fogColor?: Color,
    cameraPosition?: Vector3
  ) => void;
}

interface RayAgent {
  root: Object3D;
  mixer: AnimationMixer | null;
  swimAction: AnimationAction | null;
  position: Vector3;
  heading: Vector3;
  speed: number;
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
}

export function createStingRays(scene: Scene, sunDirection: Vector3): StingRaysController {
  const stingRaysGroup = new Group();
  stingRaysGroup.name = 'BeautifulWaterStingRaysGroup';
  scene.add(stingRaysGroup);

  const stingRayUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection },
    uFogColor: { value: new Color(0x063542) },
  };

  function applyStingRayUnderwaterShading(mat: MeshStandardMaterial, key: string) {
    mat.customProgramCacheKey = () => `${key}_${mat.uuid}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = stingRayUniforms.uTime;
      shader.uniforms.uUnderwater = stingRayUniforms.uUnderwater;
      shader.uniforms.uSunDirection = stingRayUniforms.uSunDirection;
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

        float diffuseCaustic = max(0.0, dot(refractedLight, normalize(vCustomWorldNormal)));
        vec3 causticColor = underwaterColor * (caustic * 2.2) * (0.35 + diffuseCaustic * 0.65);
        gl_FragColor.rgb += causticColor * (0.45 + gl_FragColor.rgb * 0.55);

        // Depth-based visibility & extinction
        float viewDepth = length(vViewPosition);
        vec3 extinctionCoeffs = vec3(0.20, 0.075, 0.038);
        vec3 extinction = exp(-viewDepth * extinctionCoeffs);

        vec3 viewDirection = normalize(vCustomWorldPosition - cameraPosition);
        float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);
        vec3 inscatterColor = uFogColor * (1.0 + pow(sunScatter, 5.0) * 0.45);

        gl_FragColor.rgb = gl_FragColor.rgb * extinction + inscatterColor * (1.0 - extinction.y);

        float maxViewingDistance = 22.0;
        float fadeStartDistance = 13.0;
        float distanceAlpha = 1.0 - smoothstep(fadeStartDistance, maxViewingDistance, viewDepth);
        gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, distanceAlpha);
        `
      );
    };
  }

  const RAY_COUNT = 4;
  const rays: RayAgent[] = [];
  const rayConfigs = [
    { scale: 0.52, hoverAlt: 0.32, speed: 0.95, roamRadiusX: 10.5, roamRadiusZ: 8.8, roamSpeed: 0.11, center: new Vector2(2.5, -2.0), phase: 0.0 },
    { scale: 0.46, hoverAlt: 0.45, speed: 1.05, roamRadiusX: 12.2, roamRadiusZ: 9.6, roamSpeed: 0.10, center: new Vector2(-3.2, 2.5), phase: 1.8 },
    { scale: 0.58, hoverAlt: 0.28, speed: 0.88, roamRadiusX: 13.0, roamRadiusZ: 10.5, roamSpeed: 0.09, center: new Vector2(2.8, 4.2), phase: 3.4 },
    { scale: 0.42, hoverAlt: 0.38, speed: 1.12, roamRadiusX: 9.8, roamRadiusZ: 8.2, roamSpeed: 0.12, center: new Vector2(-2.0, -4.5), phase: 4.9 },
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
      speed: cfg.speed,
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
          applyStingRayUnderwaterShading(mat, `bw_stingray_mat_${index}`);
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
        action.time = Math.random() * (clip.duration || 2.0);
        ray.mixer = mixer;
        ray.swimAction = action;
      }
    });
  }

  const loader = new GLTFLoader().setPath('assets/sting_ray/');
  loader.load(
    'sting_ray_swimming.glb',
    (gltf) => {
      initRayModel(gltf);
    },
    undefined,
    () => {
      const fallbackLoader = new GLTFLoader().setPath('/src/demo/beautiful_water/assets/sting_ray/');
      fallbackLoader.load(
        'sting_ray_swimming.glb',
        (gltf) => {
          initRayModel(gltf);
        },
        undefined,
        (err) => {
          console.error('Failed to load sting_ray_swimming.glb in beautiful_water:', err);
        }
      );
    }
  );

  return {
    group: stingRaysGroup,
    underwaterObjects: [stingRaysGroup],
    update(delta, elapsedTime, underwaterMix, fogColor, cameraPosition) {
      const safeDelta = Math.min(delta, 0.05);
      stingRayUniforms.uTime.value = elapsedTime;
      stingRayUniforms.uUnderwater.value = underwaterMix;
      if (fogColor) {
        stingRayUniforms.uFogColor.value.copy(fogColor);
      }

      rays.forEach((ray, i) => {
        if (ray.mixer) {
          ray.mixer.update(safeDelta);
        }

        ray.roamAngle += ray.roamSpeed * safeDelta;
        const lookAheadAngle = ray.roamAngle + 0.35;

        const wanderX = Math.sin(elapsedTime * 0.25 + ray.phaseOffset) * 1.4;
        const wanderZ = Math.cos(elapsedTime * 0.22 + ray.phaseOffset * 1.3) * 1.4;

        const lookAheadX = ray.roamCenter.x + Math.cos(lookAheadAngle) * ray.roamRadiusX + wanderX;
        const lookAheadZ = ray.roamCenter.y + Math.sin(lookAheadAngle) * ray.roamRadiusZ + wanderZ;

        const desiredHeading2D = new Vector2(lookAheadX - ray.position.x, lookAheadZ - ray.position.z);
        if (desiredHeading2D.lengthSq() > 0.001) {
          desiredHeading2D.normalize();
        }

        const currentAngle = Math.atan2(ray.heading.x, ray.heading.z);
        const targetAngle = Math.atan2(desiredHeading2D.x, desiredHeading2D.y);

        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const maxTurnRate = 0.65 * safeDelta;
        const turnStep = MathUtils.clamp(angleDiff, -maxTurnRate, maxTurnRate);
        const newAngle = currentAngle + turnStep;

        ray.heading.set(Math.sin(newAngle), 0, Math.cos(newAngle)).normalize();

        for (let j = 0; j < rays.length; j++) {
          if (i !== j) {
            const other = rays[j];
            const dist = ray.position.distanceTo(other.position);
            if (dist < 2.2 && dist > 0.01) {
              const repel = new Vector3().subVectors(ray.position, other.position).normalize();
              ray.heading.addScaledVector(repel, (2.2 - dist) * 0.35 * safeDelta).normalize();
            }
          }
        }

        const moveDist = ray.speed * safeDelta;
        ray.position.x += ray.heading.x * moveDist;
        ray.position.z += ray.heading.z * moveDist;

        const floorHeightAtPos = seabedHeight(ray.position.x, ray.position.z);
        const floorHeightAhead = seabedHeight(
          ray.position.x + ray.heading.x * 1.5,
          ray.position.z + ray.heading.z * 1.5
        );

        const verticalBob = Math.sin(elapsedTime * 1.4 + ray.phaseOffset) * 0.06;
        const targetAltitude = floorHeightAtPos + ray.hoverAltitude + verticalBob;

        ray.position.y = MathUtils.damp(ray.position.y, targetAltitude, 3.5, safeDelta);

        const slopeDy = floorHeightAhead - floorHeightAtPos;
        const targetPitch = MathUtils.clamp(-slopeDy * 0.45, -0.28, 0.28);
        ray.pitch = MathUtils.damp(ray.pitch, targetPitch, 4.0, safeDelta);

        const targetRoll = MathUtils.clamp(-turnStep * 18.0, -0.45, 0.45);
        ray.bankRoll = MathUtils.damp(ray.bankRoll, targetRoll, 3.0, safeDelta);

        ray.root.position.copy(ray.position);

        const yaw = Math.atan2(ray.heading.x, ray.heading.z);
        const euler = new Euler(ray.pitch, yaw, ray.bankRoll, 'YXZ');
        ray.root.quaternion.setFromEuler(euler);
      });
    },
  };
}
