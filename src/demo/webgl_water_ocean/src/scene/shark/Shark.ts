import {
  AnimationAction,
  AnimationMixer,
  Camera,
  Color,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { seabedHeight } from '../environment/Seabed';
import { computeObstacleAvoidance } from '../environment/Obstacles';

export enum SharkBehaviorState {
  PATROLLING = 'PATROLLING',
  APPROACHING_SPLASH = 'APPROACHING_SPLASH',
  CIRCLING_SPLASH = 'CIRCLING_SPLASH',
  RETURNING = 'RETURNING',
}

export interface SharkController {
  group: Group;
  position: Vector3;
  velocity: Vector3;
  attractToSplash(x: number, z: number, intensity?: number): void;
  update(
    delta: number,
    elapsedTime: number,
    underwaterMix: number,
    waterTexture: any,
    causticTexture: any,
    sunDirection: Vector3,
    onSurfaceRipple?: (x: number, z: number, strength: number, radius: number) => void,
    fogColor?: Color,
    camera?: Camera | Vector3
  ): void;
}

export function createShark(scene: Scene, sunDirection: Vector3): SharkController {
  const sharkGroup = new Group();
  sharkGroup.name = 'SharkGroup';
  scene.add(sharkGroup);

  let sharkModel: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let swimAction: AnimationAction | null = null;
  let biteAction: AnimationAction | null = null;

  const sharkUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection.clone() },
    uCausticTex: { value: null },
    uFogColor: { value: new Color(0x063542) },
  };

  function applySharkUnderwaterShading(mat: MeshStandardMaterial, key: string) {
    mat.customProgramCacheKey = () => `${key}_${mat.uuid}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sharkUniforms.uTime;
      shader.uniforms.uUnderwater = sharkUniforms.uUnderwater;
      shader.uniforms.uSunDirection = sharkUniforms.uSunDirection;
      shader.uniforms.uCausticTex = sharkUniforms.uCausticTex;
      shader.uniforms.uFogColor = sharkUniforms.uFogColor;

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
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        const float IOR_AIR = 1.0;
        const float IOR_WATER = 1.333;
        const vec3 underwaterColor = vec3(0.35, 0.85, 0.95);

        vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
        vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

        vec4 simCaust = texture2D(uCausticTex, causticCoord * 0.05 + 0.5);

        float cA = sharkValueNoise(
          causticCoord * 0.85 + vec2(
            sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
            cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
          ) + vec2(uTime * 0.08, -uTime * 0.06)
        );
        float cB = sharkValueNoise(causticCoord * 1.7 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08));
        float caustic = pow(cA, 1.6) * mix(0.20, 1.0, cB);
        float causticBreak = 0.25 + smoothstep(0.40, 0.75, sharkValueNoise(causticCoord * 0.6 + vec2(uTime * 0.02, -uTime * 0.018))) * 0.75;
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
        vec3 waterHaze = mix(
          uFogColor,
          vec3(0.08, 0.52, 0.62),
          pow(sunScatter, 3.0) * 0.40
        );

        // Plausible viewing distance fadeout in tropical sea water (fadeout between 13m and 22m)
        float maxViewDistance = 22.0;
        float visibilityFade = clamp(1.0 - smoothstep(13.0, maxViewDistance, viewDepth), 0.0, 1.0);
        vec3 effectiveExtinction = extinction * visibilityFade;

        vec3 underwaterShaded = gl_FragColor.rgb * effectiveExtinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - effectiveExtinction);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, underwaterShaded, uUnderwater);`
      );
    };
    mat.needsUpdate = true;
  }

  function setupSharkModel(gltf: any) {
    sharkModel = gltf.scene;
    sharkModel.scale.set(0.42, 0.42, 0.42);
    sharkGroup.add(sharkModel);

    sharkModel.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          if (mat instanceof MeshStandardMaterial) {
            mat.roughness = 0.38;
            mat.metalness = 0.08;
            applySharkUnderwaterShading(mat, 'shark_underwater');
          }
        });
      }
    });

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
  }

  const loader = new GLTFLoader().setPath('assets/shark/');
  loader.load(
    'Shark_biting.glb',
    (gltf) => {
      setupSharkModel(gltf);
    },
    undefined,
    (error) => {
      console.warn('Failed to load Shark_biting.glb from assets/shark/, attempting fallback paths', error);
      const fallbackLoader = new GLTFLoader().setPath('/src/demo/webgl_water_ocean/assets/shark/');
      fallbackLoader.load(
        'Shark_biting.glb',
        (gltf) => {
          setupSharkModel(gltf);
        },
        undefined,
        (fallbackError) => {
          console.warn('Attempting secondary fallback to shark.gltf', fallbackError);
          const legacyLoader = new GLTFLoader().setPath('assets/shark/');
          legacyLoader.load('shark.gltf', (legacyGltf) => {
            setupSharkModel(legacyGltf);
          });
        }
      );
    }
  );

  const sharkPosition = new Vector3(13.5, -1.6, 0.0);
  const sharkVelocity = new Vector3(0, 0, 1.0);
  const forwardHeading = new Vector3(0, 0, 1.0);
  const UP_VECTOR = new Vector3(0, 1, 0);

  // Patrol path parameters - gracefully looping trajectory bringing the shark past the viewer
  const orbitRadiusX = 6.8;
  const orbitRadiusZ = 5.2;
  let patrolAngle = 0;
  const patrolSpeed = 0.075; // Slower, calm, natural patrol orbit

  // Behavior state & curious visit mechanics
  let state: SharkBehaviorState = SharkBehaviorState.PATROLLING;
  const splashTarget = new Vector3();
  let lastSplashTime = 0;
  let inspectTimer = 0;
  let inspectDuration = 6.0;
  let inspectAngle = 0;
  const inspectRadius = 1.8;

  // Animation blend & camera orientation mechanics
  let isBiting = false;
  let biteAnimTime = 0.0;
  const BITE_DURATION = 1.65; // Duration of active biting/chomping sequence
  const BITE_TIMESCALE = 1.35; // Snappy predatory chomp speed
  let biteWeight = 0.0;
  let currentRoll = 0.0;
  let targetLookQuaternion = new Quaternion();
  let hasTargetLook = false;

  function attractToSplash(x: number, z: number, intensity = 1.0) {
    const now = performance.now();
    // Allow updating splash target if enough time has elapsed
    if (now - lastSplashTime < 600 && state === SharkBehaviorState.APPROACHING_SPLASH) {
      return;
    }
    lastSplashTime = now;

    // Target just under the surface (y = -0.02m) at the splash location so the dorsal fin and upper body breach prominently outside the water
    splashTarget.set(x, -0.22, z);
    state = SharkBehaviorState.APPROACHING_SPLASH;
  }

  return {
    group: sharkGroup,
    position: sharkPosition,
    velocity: sharkVelocity,
    attractToSplash,
    update(delta, elapsedTime, underwaterMix, waterTexture, causticTexture, sunDir, onSurfaceRipple, fogColor, camera) {
      const safeDelta = Math.min(delta, 0.05);

      let targetBiteWeight = 0.0;
      let cameraPos: Vector3 | null = null;

      if (camera) {
        if ('getWorldPosition' in camera && typeof (camera as any).getWorldPosition === 'function') {
          cameraPos = new Vector3();
          (camera as any).getWorldPosition(cameraPos);
        } else if ('position' in camera && (camera as Camera).position) {
          cameraPos = (camera as Camera).position;
        } else if (camera instanceof Vector3) {
          cameraPos = camera;
        }
      }

      let toCameraDir = new Vector3();
      let mouthToCameraDist = 999.0;
      let approachBlend = 0.0;
      let sideToCamera = 0.0;

      if (cameraPos) {
        // Calculate distance from shark snout / mouth to camera (scaled forward to tip of snout)
        const sharkMouthPos = new Vector3().copy(sharkPosition).addScaledVector(forwardHeading, 2.2);
        mouthToCameraDist = sharkMouthPos.distanceTo(cameraPos);
        toCameraDir.subVectors(cameraPos, sharkMouthPos).normalize();

        // Calculate approach blend factor (approaching within 3.8 meters of camera)
        approachBlend = MathUtils.clamp((3.8 - mouthToCameraDist) / 2.8, 0.0, 1.0);

        // Determine which side (left vs right) the camera is relative to shark heading
        const rightVec = new Vector3().crossVectors(UP_VECTOR, forwardHeading).normalize();
        sideToCamera = rightVec.dot(toCameraDir);

        // Trigger bite sequence when approaching closely to the camera
        if (mouthToCameraDist <= 2.4 && !isBiting) {
          isBiting = true;
          biteAnimTime = 0.0;
          if (biteAction) {
            biteAction.reset();
            biteAction.play();
          }
        }
      }

      // Handle biting state & full animation playback progression
      if (isBiting) {
        biteAnimTime += safeDelta * BITE_TIMESCALE;

        // Smooth envelope for the bite animation:
        // Quick 0.15s ramp up, hold full 1.0 weight through active chomp phases, then smooth return to cruise
        if (biteAnimTime < 0.15) {
          targetBiteWeight = MathUtils.smoothstep(biteAnimTime, 0.0, 0.15);
        } else if (biteAnimTime <= 1.35) {
          targetBiteWeight = 1.0;
        } else if (biteAnimTime < BITE_DURATION) {
          targetBiteWeight = 1.0 - MathUtils.smoothstep(biteAnimTime, 1.35, BITE_DURATION);
        } else {
          // Completed full bite animation cycle
          if (mouthToCameraDist <= 1.8) {
            // Still in close proximity - trigger another playful chomp cycle
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

      // Smooth weight transition for bite animation
      biteWeight = MathUtils.damp(biteWeight, targetBiteWeight, 12.0, safeDelta);

      if (mixer) {
        if (swimAction) {
          const swimTimeScale = state === SharkBehaviorState.APPROACHING_SPLASH ? 0.60 : 0.48;
          swimAction.timeScale = swimTimeScale;
          // Scale down swimAction to 0 so it doesn't counteract the jaw opening
          swimAction.setEffectiveWeight(Math.max(0.0, 1.0 - biteWeight));
        }
        if (biteAction) {
          biteAction.timeScale = BITE_TIMESCALE;
          biteAction.setEffectiveWeight(biteWeight);
        }
        mixer.update(safeDelta);
      }

      sharkUniforms.uTime.value = elapsedTime;
      sharkUniforms.uUnderwater.value = underwaterMix;
      sharkUniforms.uSunDirection.value.copy(sunDir);
      sharkUniforms.uCausticTex.value = causticTexture;
      if (fogColor) {
        sharkUniforms.uFogColor.value.copy(fogColor);
      }

      const targetPos = new Vector3();
      let currentSpeed = 0.90; // Slower, majestic cruising speed

      switch (state) {
        case SharkBehaviorState.PATROLLING: {
          // Track current angular position on orbit with smooth lookahead
          const currentAngle = Math.atan2(sharkPosition.z / orbitRadiusZ, sharkPosition.x / orbitRadiusX);
          const lookaheadAngle = currentAngle + 0.38; // Smooth lookahead along trajectory

          const currentRadiusX = orbitRadiusX + Math.sin(currentAngle * 2.0) * 0.8;
          const currentRadiusZ = orbitRadiusZ + Math.cos(currentAngle * 1.5) * 0.6;

          // Periodic surface cruising modulation:
          // The shark alternates between mid-depth cruising (-1.35m to -1.80m) and surface cruising (-0.26m)
          // where its dorsal fin (~0.85m tall) breaches above the surface (y = 0.0) while its body remains submerged
          const surfaceCycle = Math.sin(elapsedTime * 0.09) * 0.55 + Math.sin(elapsedTime * 0.035 + 1.2) * 0.45;
          const surfaceBlend = MathUtils.smoothstep(surfaceCycle, -0.05, 0.55);

          const deepY = -1.45 + Math.sin(currentAngle * 2.5) * 0.35;
          const surfaceY = -0.26 + Math.sin(currentAngle * 1.5) * 0.03;
          const currentY = MathUtils.lerp(deepY, surfaceY, surfaceBlend);

          targetPos.set(
            Math.cos(lookaheadAngle) * currentRadiusX,
            currentY,
            Math.sin(lookaheadAngle) * currentRadiusZ
          );
          currentSpeed = 0.90;
          break;
        }

        case SharkBehaviorState.APPROACHING_SPLASH: {
          // When approaching splash, ascend smoothly towards the surface level so the dorsal fin is sticking out of the water while travelling
          targetPos.set(splashTarget.x, -0.22, splashTarget.z);
          currentSpeed = 1.35; // Curious, purposeful surge towards splash

          const distToSplash = sharkPosition.distanceTo(targetPos);
          if (distToSplash < 1.8) {
            state = SharkBehaviorState.CIRCLING_SPLASH;
            inspectTimer = 0;
            inspectDuration = 7.0 + Math.random() * 3.5;
            inspectAngle = Math.atan2(sharkPosition.z - splashTarget.z, sharkPosition.x - splashTarget.x);
          }
          break;
        }

        case SharkBehaviorState.CIRCLING_SPLASH: {
          inspectTimer += safeDelta;
          inspectAngle += 0.18 * safeDelta; // Wide, slow curious circle under/around splash site

          const circleLookahead = inspectAngle + 0.40;
          const circleY = -0.22 + Math.sin(inspectTimer * 0.4) * 0.04;
          targetPos.set(
            splashTarget.x + Math.cos(circleLookahead) * inspectRadius,
            circleY,
            splashTarget.z + Math.sin(circleLookahead) * inspectRadius
          );
          currentSpeed = 0.95;

          if (inspectTimer >= inspectDuration) {
            state = SharkBehaviorState.RETURNING;
          }
          break;
        }

        case SharkBehaviorState.RETURNING: {
          // Find closest point on patrol ellipse and steer towards a smooth lookahead point on it
          const angleOnPatrol = Math.atan2(sharkPosition.z / orbitRadiusZ, sharkPosition.x / orbitRadiusX);
          const lookaheadPatrol = angleOnPatrol + 0.35;
          const returnSurfaceCycle = Math.sin(elapsedTime * 0.09) * 0.55 + Math.sin(elapsedTime * 0.035 + 1.2) * 0.45;
          const returnSurfaceBlend = MathUtils.smoothstep(returnSurfaceCycle, -0.05, 0.55);
          const returnDeepY = -1.45 + Math.sin(lookaheadPatrol * 2.5) * 0.35;
          const returnSurfaceY = -0.26 + Math.sin(lookaheadPatrol * 1.5) * 0.03;
          const returnY = MathUtils.lerp(returnDeepY, returnSurfaceY, returnSurfaceBlend);
          targetPos.set(
            Math.cos(lookaheadPatrol) * orbitRadiusX,
            returnY,
            Math.sin(lookaheadPatrol) * orbitRadiusZ
          );
          currentSpeed = 0.95;

          const distToPatrol = sharkPosition.distanceTo(targetPos);
          if (distToPatrol < 2.8) {
            state = SharkBehaviorState.PATROLLING;
          }
          break;
        }
      }

      // Calculate obstacle avoidance forces (stones and kelp)
      const obstacleAvoidance = computeObstacleAvoidance(
        sharkPosition.x,
        sharkPosition.y,
        sharkPosition.z,
        forwardHeading.x,
        forwardHeading.z,
        1.10, // Shark body radius scaled realistically
        5.5,  // Lookahead distance
        0.65, // Safety clearance margin
        0.35  // Vertical padding
      );

      // Smooth steering toward targetPos with obstacle evasion and realistic maximum turn rate
      const desiredDirection = new Vector3().subVectors(targetPos, sharkPosition);
      if (desiredDirection.lengthSq() > 0.001) {
        desiredDirection.normalize();

        // Blend in obstacle avoidance steering vector to smoothly divert around kelp and rocks
        if (obstacleAvoidance.isObstructed) {
          const steerVec = new Vector3(obstacleAvoidance.steerX, 0, obstacleAvoidance.steerZ);
          desiredDirection.addScaledVector(steerVec, 2.2).normalize();
        }

        // Calculate horizontal yaw heading and target yaw
        const currentYaw = Math.atan2(forwardHeading.x, forwardHeading.z);
        const targetYaw = Math.atan2(desiredDirection.x, desiredDirection.z);

        let diffYaw = targetYaw - currentYaw;
        while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;

        // Maximum angular turn rate in radians/second (higher when evading obstacles or approaching splashes)
        const baseTurnRate = (state === SharkBehaviorState.APPROACHING_SPLASH) ? 0.50 : 0.38;
        const maxTurnRate = obstacleAvoidance.isObstructed ? 0.68 : baseTurnRate;
        const maxAngleStep = maxTurnRate * safeDelta;
        const appliedTurn = MathUtils.clamp(diffYaw, -maxAngleStep, maxAngleStep);

        const newYaw = currentYaw + appliedTurn;
        forwardHeading.set(Math.sin(newYaw), 0, Math.cos(newYaw));

        // Smooth pitch (Y) adjustment (including upward lift if swimming over low rock mounds, flattening out at surface)
        const targetY = targetPos.y + (obstacleAvoidance.liftY > 0 ? obstacleAvoidance.liftY * 0.6 : 0);
        const maxPitchUp = MathUtils.clamp((0.0 - sharkPosition.y) / 0.15 * 0.18, 0.02, 0.18);
        const desiredPitch = MathUtils.clamp((targetY - sharkPosition.y) * 0.35, -0.18, maxPitchUp);
        forwardHeading.y = MathUtils.damp(forwardHeading.y, desiredPitch, 1.2, safeDelta);
        forwardHeading.normalize();
      }

      // Apply forward velocity
      sharkVelocity.copy(forwardHeading).multiplyScalar(currentSpeed);
      sharkPosition.addScaledVector(sharkVelocity, safeDelta);

      // Apply obstacle proximity pushout to guarantee no clipping through stones or kelp stems
      if (obstacleAvoidance.pushX !== 0 || obstacleAvoidance.pushZ !== 0) {
        sharkPosition.x += obstacleAvoidance.pushX * 2.2 * safeDelta;
        sharkPosition.z += obstacleAvoidance.pushZ * 2.2 * safeDelta;
      }
      if (obstacleAvoidance.liftY > 0) {
        sharkPosition.y += obstacleAvoidance.liftY * 0.8 * safeDelta;
      }

      // Boundary constraint: stay above seabed and just under surface (max y = -0.02m)
      const floorY = seabedHeight(sharkPosition.x, sharkPosition.z) + 1.15;
      sharkPosition.y = MathUtils.clamp(sharkPosition.y, floorY, -0.02);

      sharkGroup.position.copy(sharkPosition);

      // Surface ripple generation for shark (body, slicing dorsal fin, and oscillating tail fin wake)
      const dorsalFinY = sharkPosition.y + 0.82;
      if (onSurfaceRipple && dorsalFinY >= -0.25) {
        const isBreaching = dorsalFinY >= 0.0;
        const proximity = MathUtils.clamp(1.0 - Math.abs(Math.min(0.0, dorsalFinY)) / 0.35, 0.0, 1.0);
        const finMultiplier = isBreaching ? 1.6 : proximity;

        // Shark head/bow wake ripple
        const headOffset = forwardHeading.clone().multiplyScalar(1.8);
        onSurfaceRipple(sharkPosition.x + headOffset.x, sharkPosition.z + headOffset.z, 0.045 * finMultiplier, 0.016);

        // Shark dorsal fin slicing wake ripple
        onSurfaceRipple(sharkPosition.x, sharkPosition.z, (isBreaching ? 0.075 : 0.055) * finMultiplier, 0.020);

        // Dorsal fin lateral bow wave ripples (V-wake when cutting through surface)
        if (isBreaching) {
          const perp = new Vector3(-forwardHeading.z, 0, forwardHeading.x).multiplyScalar(0.28);
          onSurfaceRipple(sharkPosition.x + perp.x - forwardHeading.x * 0.35, sharkPosition.z + perp.z - forwardHeading.z * 0.35, 0.038, 0.012);
          onSurfaceRipple(sharkPosition.x - perp.x - forwardHeading.x * 0.35, sharkPosition.z - perp.z - forwardHeading.z * 0.35, 0.038, 0.012);
        }

        // Shark tail wake ripple
        const tailOffset = forwardHeading.clone().multiplyScalar(-2.6);
        const tailSway = Math.sin(elapsedTime * 2.2) * 0.45;
        const tailPerp = new Vector3(-forwardHeading.z, 0, forwardHeading.x).multiplyScalar(tailSway);
        onSurfaceRipple(
          sharkPosition.x + tailOffset.x + tailPerp.x,
          sharkPosition.z + tailOffset.z + tailPerp.z,
          0.040 * finMultiplier,
          0.015
        );
      }

      // Heading and body orientation
      // During camera approach and bite encounters, naturally turn head up and roll body on its side
      // with the mouth directed towards the camera
      if (Math.abs(forwardHeading.x) > 0.0001 || Math.abs(forwardHeading.z) > 0.0001) {
        let aimDirection = forwardHeading.clone();

        // Blend heading slightly towards camera so mouth is directly facing the camera
        if (approachBlend > 0.01 && toCameraDir.lengthSq() > 0.001) {
          const mouthAimInfluence = Math.min(0.38, approachBlend * 0.38);
          aimDirection.lerp(toCameraDir, mouthAimInfluence).normalize();
        }

        // Upward head tilt during camera approach: Elevate head/snout up naturally
        const headPitchUp = approachBlend * 0.24; // ~14 degrees upward head elevation
        const baseRight = new Vector3().crossVectors(UP_VECTOR, aimDirection).normalize();
        const pitchQuat = new Quaternion().setFromAxisAngle(baseRight, -headPitchUp);
        aimDirection.applyQuaternion(pitchQuat).normalize();

        const rightOrtho = new Vector3().crossVectors(UP_VECTOR, aimDirection).normalize();
        const upOrtho = new Vector3().crossVectors(aimDirection, rightOrtho).normalize();

        // Roll on side: Apex predators rotate body on its side when approaching/inspecting/biting
        // with the mouth/belly oriented towards the camera
        const targetRoll = (sideToCamera >= 0 ? 1.0 : -1.0) * Math.min(Math.abs(sideToCamera) * 1.3, 1.0) * (0.45 * approachBlend);
        currentRoll = MathUtils.damp(currentRoll, targetRoll, 4.0, safeDelta);

        const rightRolled = rightOrtho.clone().multiplyScalar(Math.cos(currentRoll)).addScaledVector(upOrtho, Math.sin(currentRoll)).normalize();
        const upRolled = upOrtho.clone().multiplyScalar(Math.cos(currentRoll)).addScaledVector(rightOrtho, -Math.sin(currentRoll)).normalize();

        const orientMatrix = new Matrix4();
        orientMatrix.makeBasis(rightRolled, upRolled, aimDirection);
        const orientationQuat = new Quaternion().setFromRotationMatrix(orientMatrix);

        sharkGroup.quaternion.slerp(orientationQuat, Math.min(1.0, safeDelta * 4.5));
      }
    },
  };
}
