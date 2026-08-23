import {
  AnimationAction,
  AnimationMixer,
  Bone,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { seabedHeight } from './environment';

export interface SharkController {
  group: Group;
  position: Vector3;
  velocity: Vector3;
  update: (
    delta: number,
    elapsedTime: number,
    underwaterMix: number,
    cameraIsUnderwater: boolean,
    cameraPosition: Vector3,
    cameraDirection: Vector3
  ) => void;
}

enum SharkState {
  CIRCLING_BUOY = 0,
  APPROACHING_CAMERA = 1,
  PASSING_CAMERA = 2,
  DEPARTING_CAMERA = 3,
}

export function createShark(scene: Scene, sunDirection: Vector3): SharkController {
  const sharkGroup = new Group();
  sharkGroup.name = 'SharkControllerGroup';
  scene.add(sharkGroup);

  let sharkModel: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let swimAction: AnimationAction | null = null;
  let biteAction: AnimationAction | null = null;

  const sharkUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection },
  };

  function applySharkUnderwaterShading(mat: MeshStandardMaterial, key: string) {
    mat.customProgramCacheKey = () => `${key}_${mat.uuid}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sharkUniforms.uTime;
      shader.uniforms.uUnderwater = sharkUniforms.uUnderwater;
      shader.uniforms.uSunDirection = sharkUniforms.uSunDirection;

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

        float sharkHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float sharkValueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(sharkHash(i + vec2(0.0, 0.0)), sharkHash(i + vec2(1.0, 0.0)), u.x),
            mix(sharkHash(i + vec2(0.0, 1.0)), sharkHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      ).replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          // Snell's Law refraction and caustic projection matching ocean floor (threejs_water_shark)
          const float IOR_AIR = 1.0;
          const float IOR_WATER = 1.333;
          const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
          vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
          vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

          float cA = sharkValueNoise(
            causticCoord * 0.82 + vec2(
              sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
              cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
            ) + vec2(uTime * 0.08, -uTime * 0.06)
          );
          float cB = sharkValueNoise(
            causticCoord * 1.65 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08)
          );
          float caustic = pow(cA, 1.55) * mix(0.18, 1.0, cB);
          float causticBreak = 0.22 + smoothstep(0.43, 0.73, sharkValueNoise(
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
  }

  function setupSharkModel(gltf: any) {
    sharkModel = gltf.scene;
    sharkModel.scale.set(0.32, 0.32, 0.32);

    mixer = new AnimationMixer(sharkModel);
    if (gltf.animations && gltf.animations.length > 0) {
      const swimClip = gltf.animations.find((a: any) => a.name === 'ArmatureAction') || gltf.animations[0];
      const biteClip = gltf.animations.find((a: any) => a.name === 'Shark_Bite' || a.name.toLowerCase().includes('bite'));

      if (swimClip) {
        swimAction = mixer.clipAction(swimClip);
        swimAction.play();
      }
      if (biteClip) {
        biteAction = mixer.clipAction(biteClip);
        biteAction.play();
        biteAction.setEffectiveWeight(0.0);
      }
    }

    sharkModel.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = false;

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          if (mat instanceof MeshStandardMaterial) {
            mat.roughness = 0.35;
            mat.metalness = 0.08;
            mat.emissive.setHex(0x0c3336);
            mat.emissiveIntensity = 0.40;
            applySharkUnderwaterShading(mat, 'shark_standard_fog');
          }
        });
      }
    });

    sharkGroup.add(sharkModel);
  }

  const loader = new GLTFLoader().setPath('assets/shark/');
  loader.load(
    'Shark_biting.glb',
    (gltf) => {
      setupSharkModel(gltf);
    },
    undefined,
    (err) => {
      console.warn('Failed to load Shark_biting.glb, trying fallback paths:', err);
      const fallbackLoader = new GLTFLoader().setPath('/src/demo/threejs_water_shark/assets/shark/');
      fallbackLoader.load(
        'Shark_biting.glb',
        (gltf) => {
          setupSharkModel(gltf);
        },
        undefined,
        (fallbackErr) => {
          console.warn('Trying legacy fallback shark.gltf:', fallbackErr);
          const legacyLoader = new GLTFLoader().setPath('assets/shark/');
          legacyLoader.load('shark.gltf', (legacyGltf) => {
            setupSharkModel(legacyGltf);
          });
        }
      );
    }
  );

  // Behavior state & kinematics
  let state: SharkState = SharkState.CIRCLING_BUOY;
  const position = new Vector3(6.5, -2.4, 0);
  const velocity = new Vector3(0, 0, 1.8);
  const forwardHeading = new Vector3(0, 0, 1);
  const UP_VECTOR = new Vector3(0, 1, 0);
  const targetPosition = new Vector3();
  const currentRotation = new Quaternion();
  const targetRotation = new Quaternion();

  let orbitAngle = 0;
  const orbitRadius = 6.2;
  const orbitDepth = -2.35;
  let orbitSpeed = 0.38;

  let curiousPassTimer = 0;
  let curiousPassCooldown = 4.0;
  let passPhase = 0;
  const passEntryPoint = new Vector3();
  const passMidPoint = new Vector3();
  const passExitPoint = new Vector3();

  let isBiting = false;
  let biteAnimTime = 0.0;
  const BITE_DURATION = 1.65;
  const BITE_TIMESCALE = 1.35;
  let biteWeight = 0.0;
  let currentRoll = 0.0;

  return {
    group: sharkGroup,
    position,
    velocity,
    update(
      delta: number,
      elapsedTime: number,
      underwaterMix: number,
      cameraIsUnderwater: boolean,
      cameraPosition: Vector3,
      cameraDirection: Vector3
    ) {
      sharkUniforms.uTime.value = elapsedTime;
      sharkUniforms.uUnderwater.value = underwaterMix;

      const safeDelta = Math.min(delta, 0.05);

      // State machine transitions
      curiousPassCooldown -= safeDelta;

      if (cameraIsUnderwater && underwaterMix > 0.45) {
        if (state === SharkState.CIRCLING_BUOY && curiousPassCooldown <= 0) {
          // Transition to APPROACHING_CAMERA
          state = SharkState.APPROACHING_CAMERA;
          curiousPassTimer = 0;
          passPhase = 0;

          // Compute smooth pass trajectory points around camera
          const camRight = new Vector3(-cameraDirection.z, 0, cameraDirection.x).normalize();
          const sideOffset = Math.sin(elapsedTime * 1.5) > 0 ? 1 : -1;

          // Entry point: toward front side of camera
          passEntryPoint.copy(cameraPosition)
            .addScaledVector(cameraDirection, 4.5)
            .addScaledVector(camRight, 2.8 * sideOffset);
          passEntryPoint.y = MathUtils.clamp(cameraPosition.y - 0.6, -7.0, -1.0);

          // Mid point: passing right across the camera view in front
          passMidPoint.copy(cameraPosition)
            .addScaledVector(cameraDirection, 1.85)
            .addScaledVector(camRight, -0.6 * sideOffset);
          passMidPoint.y = MathUtils.clamp(cameraPosition.y - 0.35, -7.0, -0.8);

          // Exit point: moving away behind / past camera
          passExitPoint.copy(cameraPosition)
            .addScaledVector(cameraDirection, -3.2)
            .addScaledVector(camRight, -3.2 * sideOffset);
          passExitPoint.y = MathUtils.clamp(cameraPosition.y - 0.9, -7.0, -1.2);
        }
      } else {
        if (state !== SharkState.CIRCLING_BUOY) {
          state = SharkState.DEPARTING_CAMERA;
        }
      }

      let speed = 2.0;
      let targetBiteWeight = 0.0;
      let targetCameraRoll = 0.0;

      switch (state) {
        case SharkState.CIRCLING_BUOY: {
          orbitAngle += orbitSpeed * safeDelta;

          // Slight natural modulation in orbit radius and height
          const currentRadius = orbitRadius + Math.sin(orbitAngle * 2.0) * 0.75;
          const currentY = orbitDepth + Math.cos(orbitAngle * 1.5) * 0.45;

          targetPosition.set(
            Math.cos(orbitAngle) * currentRadius,
            currentY,
            Math.sin(orbitAngle) * currentRadius
          );

          speed = 1.9;
          break;
        }

        case SharkState.APPROACHING_CAMERA: {
          curiousPassTimer += safeDelta;
          targetPosition.copy(passEntryPoint);
          targetBiteWeight = 0.25;
          speed = 2.4;

          const distToEntry = position.distanceTo(passEntryPoint);
          if (distToEntry < 2.0 || curiousPassTimer > 6.0) {
            state = SharkState.PASSING_CAMERA;
            curiousPassTimer = 0;
          }
          break;
        }

        case SharkState.PASSING_CAMERA: {
          curiousPassTimer += safeDelta;
          targetPosition.copy(passMidPoint);

          const sharkHeadPos = new Vector3().copy(position).addScaledVector(forwardHeading, 1.2);
          const distToCam = Math.min(sharkHeadPos.distanceTo(cameraPosition), position.distanceTo(cameraPosition));

          if (distToCam <= 4.2) {
            const biteFactor = MathUtils.clamp((4.2 - distToCam) / 2.8, 0.0, 1.0);
            targetBiteWeight = MathUtils.smoothstep(biteFactor, 0.0, 1.0);
          }

          speed = 2.6;

          if (position.distanceTo(passMidPoint) < 1.6 || curiousPassTimer > 5.0) {
            state = SharkState.DEPARTING_CAMERA;
            curiousPassTimer = 0;
          }
          break;
        }

        case SharkState.DEPARTING_CAMERA: {
          curiousPassTimer += safeDelta;
          targetPosition.copy(passExitPoint);
          targetBiteWeight = 0.0;
          speed = 2.5;

          if (position.distanceTo(passExitPoint) < 2.0 || curiousPassTimer > 6.0) {
            state = SharkState.CIRCLING_BUOY;
            curiousPassCooldown = 6.0 + Math.random() * 5.0; // Cooldown before next curious pass
            orbitAngle = Math.atan2(position.z, position.x);
          }
          break;
        }
      }

      // Check proximity to camera for bite action and camera-oriented mouth alignment
      let toCameraDir = new Vector3();
      const sharkMouthPos = new Vector3().copy(position).addScaledVector(forwardHeading, 1.2);
      const distToHeadCam = sharkMouthPos.distanceTo(cameraPosition);
      toCameraDir.subVectors(cameraPosition, sharkMouthPos).normalize();

      const approachBlend = MathUtils.clamp((3.8 - distToHeadCam) / 2.8, 0.0, 1.0);
      const rightVec = new Vector3().crossVectors(UP_VECTOR, forwardHeading).normalize();
      const sideToCamera = rightVec.dot(toCameraDir);

      if (distToHeadCam <= 2.4 && !isBiting) {
        isBiting = true;
        biteAnimTime = 0.0;
        if (biteAction) {
          biteAction.reset();
          biteAction.play();
        }
      }

      if (isBiting) {
        biteAnimTime += safeDelta * BITE_TIMESCALE;
        if (biteAnimTime < 0.15) {
          targetBiteWeight = MathUtils.smoothstep(biteAnimTime, 0.0, 0.15);
        } else if (biteAnimTime <= 1.35) {
          targetBiteWeight = 1.0;
        } else if (biteAnimTime < BITE_DURATION) {
          targetBiteWeight = 1.0 - MathUtils.smoothstep(biteAnimTime, 1.35, BITE_DURATION);
        } else {
          if (distToHeadCam <= 1.8) {
            biteAnimTime = 0.0;
            if (biteAction) {
              biteAction.reset();
              biteAction.play();
            }
            targetBiteWeight = 1.0;
          } else {
            isBiting = false;
            targetBiteWeight = 0.0;
          }
        }
      } else {
        targetBiteWeight = 0.0;
      }

      biteWeight = MathUtils.damp(biteWeight, targetBiteWeight, 12.0, safeDelta);

      if (mixer) {
        if (swimAction) {
          const swimSpeedMultiplier = state === SharkState.CIRCLING_BUOY ? 1.0 : 1.35;
          swimAction.timeScale = swimSpeedMultiplier;
          swimAction.setEffectiveWeight(Math.max(0.0, 1.0 - biteWeight));
        }
        if (biteAction) {
          biteAction.timeScale = BITE_TIMESCALE;
          biteAction.setEffectiveWeight(biteWeight);
        }
        mixer.update(safeDelta);
      }

      // Smooth steering toward targetPosition
      const desiredHeading = new Vector3().subVectors(targetPosition, position);
      const dist = desiredHeading.length();
      if (dist > 0.01) {
        desiredHeading.normalize();
      }

      // Steering acceleration
      const steerFactor = state === SharkState.CIRCLING_BUOY ? 1.6 : 2.8;
      forwardHeading.lerp(desiredHeading, Math.min(safeDelta * steerFactor, 1.0)).normalize();

      velocity.copy(forwardHeading).multiplyScalar(speed);
      position.addScaledVector(velocity, safeDelta);

      // Keep shark submerged above seabed
      const floor = seabedHeight(position.x, position.z) + 1.2;
      position.y = MathUtils.clamp(position.y, floor, -0.45);

      sharkGroup.position.copy(position);

      // Smooth rotation with upward head tilt and body roll on side during approach
      let aimDirection = forwardHeading.clone();
      if (approachBlend > 0.01 && toCameraDir.lengthSq() > 0.001) {
        const mouthAimInfluence = Math.min(0.38, approachBlend * 0.38);
        aimDirection.lerp(toCameraDir, mouthAimInfluence).normalize();
      }

      // Upward head tilt
      const headPitchUp = approachBlend * 0.24;
      const baseRight = new Vector3().crossVectors(UP_VECTOR, aimDirection).normalize();
      const pitchQuat = new Quaternion().setFromAxisAngle(baseRight, -headPitchUp);
      aimDirection.applyQuaternion(pitchQuat).normalize();

      const rightOrtho = new Vector3().crossVectors(UP_VECTOR, aimDirection).normalize();
      const upOrtho = new Vector3().crossVectors(aimDirection, rightOrtho).normalize();

      // Roll body on side towards camera
      const targetRoll = (sideToCamera >= 0 ? 1.0 : -1.0) * Math.min(Math.abs(sideToCamera) * 1.3, 1.0) * (0.45 * approachBlend);
      currentRoll = MathUtils.damp(currentRoll, targetRoll, 4.0, safeDelta);

      const rightRolled = rightOrtho.clone().multiplyScalar(Math.cos(currentRoll)).addScaledVector(upOrtho, Math.sin(currentRoll)).normalize();
      const upRolled = upOrtho.clone().multiplyScalar(Math.cos(currentRoll)).addScaledVector(rightOrtho, -Math.sin(currentRoll)).normalize();

      const orientMatrix = new Matrix4();
      orientMatrix.makeBasis(rightRolled, upRolled, aimDirection);
      const orientationQuat = new Quaternion().setFromRotationMatrix(orientMatrix);

      sharkGroup.quaternion.slerp(orientationQuat, Math.min(1.0, safeDelta * 4.5));
    },
  };
}
