import {
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3
} from 'three';
import { seabedHeight } from './environment';
import { sampleOceanSurface } from './waves';

const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const SCHOOL_RADIUS = 3.4;
const SEPARATION_RADIUS = 0.72;
const CAMERA_NOTICE_RADIUS = 9.0;
const SHARK_NOTICE_RADIUS = 7.5;

const SCHOOL_PRESETS = [
  { center: new Vector3(4.2, -1.75, 3.8), count: 17, tint: 0x69c5ba },
  { center: new Vector3(-6.4, -2.15, -3.2), count: 15, tint: 0x8abcb5 },
  { center: new Vector3(1.3, -1.45, -8.0), count: 13, tint: 0xd0bc7b },
];

function createTailGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, 0, -0.28,
    0, 0.18, -0.62,
    0, 0, -0.51,
    0, -0.18, -0.62,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function clampVectorLength(vector: Vector3, maximum: number): Vector3 {
  const lengthSquared = vector.lengthSq();
  if (lengthSquared > maximum * maximum) vector.setLength(maximum);
  return vector;
}

interface FishIndividual {
  index: number;
  school: number;
  position: Vector3;
  velocity: Vector3;
  acceleration: Vector3;
  scale: number;
  cruisingSpeed: number;
  phase: number;
  curiosity: number;
}

export interface FishSchoolsController {
  underwaterObjects: Object3D[];
  update(
    time: number,
    underwaterMix: number,
    camera: Camera,
    sharkPosition?: Vector3,
    sharkVelocity?: Vector3
  ): void;
  getDiagnostics(camera: Camera): any;
}

export function createFishSchools(scene: Scene, sunDirection: Vector3 = new Vector3(-0.58, 0.10, -0.81).normalize()): FishSchoolsController {
  let randomState = 0x5eaf00d;
  function seededRandom(): number {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  const fishUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection.clone() },
  };

  const applyBeerLambertFog = (mat: MeshStandardMaterial) => {
    mat.customProgramCacheKey = () => 'fish_beer_lambert_fog';
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uTime = fishUniforms.uTime;
      shader.uniforms.uUnderwater = fishUniforms.uUnderwater;
      shader.uniforms.uSunDirection = fishUniforms.uSunDirection;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCustomWorldPosition;
        varying vec3 vCustomWorldNormal;
        varying vec3 vLocalPosition;`
      ).replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vLocalPosition = position;
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
        varying vec3 vLocalPosition;
        uniform float uTime;
        uniform float uUnderwater;
        uniform vec3 uSunDirection;

        float fishHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float fishValueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(fishHash(i + vec2(0.0, 0.0)), fishHash(i + vec2(1.0, 0.0)), u.x),
            mix(fishHash(i + vec2(0.0, 1.0)), fishHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      ).replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Depth-based fish skin texture rendering
        // 1. Procedural micro-scale depth relief pattern
        float scaleU = vLocalPosition.z * 24.0;
        float scaleV = atan(vLocalPosition.y, vLocalPosition.x) * 4.5;
        float scaleCell = sin(scaleU + sin(scaleV * 3.14159) * 0.55) * cos(scaleV * 3.14159);
        float scaleDepthRelief = smoothstep(-0.35, 0.45, scaleCell);

        // 2. Vertical depth countershading (dorsal dark, ventral silvery belly, lateral iridescent stripe)
        float normY = clamp(vLocalPosition.y * 3.2, -1.0, 1.0);
        vec3 dorsalColor = diffuseColor.rgb * vec3(0.32, 0.52, 0.65);
        vec3 ventralColor = mix(diffuseColor.rgb, vec3(0.92, 0.96, 0.98), 0.68);
        vec3 baseSkin = mix(ventralColor, dorsalColor, smoothstep(-0.4, 0.4, normY));

        // Silvery iridescent lateral line
        float lateralLine = exp(-pow(normY * 4.2, 2.0));
        vec3 lateralColor = vec3(0.72, 0.94, 0.98);
        baseSkin = mix(baseSkin, lateralColor, lateralLine * 0.55);

        // Scale relief modulated by view depth (depth-based LOD / micro-depth)
        float linearDepth = length(vViewPosition);
        float depthDetailFade = clamp(1.0 - linearDepth / 9.0, 0.0, 1.0);
        baseSkin *= mix(1.0, 0.82 + scaleDepthRelief * 0.32, depthDetailFade);

        // 3. Guanine crystal iridescence sheen based on viewing angle & distance
        float fresnelSheen = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(-vViewPosition))), 2.8);
        vec3 iridColor = mix(vec3(0.35, 0.88, 1.0), vec3(0.88, 0.45, 0.85), sin(vLocalPosition.z * 16.0 + uTime * 2.2) * 0.5 + 0.5);
        baseSkin += iridColor * fresnelSheen * 0.45 * depthDetailFade;

        diffuseColor.rgb = baseSkin;`
      ).replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          // Snell's Law refraction and caustic projection (threejs_water_shark)
          const float IOR_AIR = 1.0;
          const float IOR_WATER = 1.333;
          const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
          vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
          vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

          float cA = fishValueNoise(
            causticCoord * 0.82 + vec2(
              sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
              cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
            ) + vec2(uTime * 0.08, -uTime * 0.06)
          );
          float cB = fishValueNoise(
            causticCoord * 1.65 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08)
          );
          float caustic = pow(cA, 1.55) * mix(0.18, 1.0, cB);
          float causticBreak = 0.22 + smoothstep(0.43, 0.73, fishValueNoise(
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

          // Physical Beer-Lambert multi-wavelength extinction (red absorbed fastest, cyan/blue penetrate furthest)
          vec3 extinction = exp(-distanceToCamera * vec3(0.16, 0.08, 0.055));

          // Depth-based sunlight extinction
          float depthBelowSurface = max(0.0, -vCustomWorldPosition.y);
          vec3 depthExtinction = exp(-depthBelowSurface * vec3(0.035, 0.012, 0.006));

          vec3 underwaterShaded = outgoingLight * depthExtinction * extinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - extinction);
          outgoingLight = mix(outgoingLight, underwaterShaded, uUnderwater);
        #endif`
      );
    };
    mat.needsUpdate = true;
  };

  const fishCount = SCHOOL_PRESETS.reduce((sum, school) => sum + school.count, 0);
  const bodyGeometry = new SphereGeometry(0.5, 10, 6);
  const tailGeometry = createTailGeometry();
  const bodyMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.12,
    emissive: 0x144c48,
    emissiveIntensity: 0.45,
  });
  const tailMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0.06,
    emissive: 0x0f3e3a,
    emissiveIntensity: 0.38,
    side: DoubleSide,
  });
  applyBeerLambertFog(bodyMaterial);
  applyBeerLambertFog(tailMaterial);
  const bodies = new InstancedMesh(
    bodyGeometry,
    bodyMaterial,
    fishCount,
  );
  const tails = new InstancedMesh(
    tailGeometry,
    tailMaterial,
    fishCount,
  );
  bodies.frustumCulled = false;
  tails.frustumCulled = false;
  bodies.renderOrder = 2;
  tails.renderOrder = 2;
  scene.add(bodies, tails);

  const fish: FishIndividual[] = [];
  const color = new Color();
  let fishIndex = 0;
  SCHOOL_PRESETS.forEach((school, schoolIndex) => {
    for (let localIndex = 0; localIndex < school.count; localIndex += 1) {
      const angle = seededRandom() * Math.PI * 2;
      const radius = Math.sqrt(seededRandom()) * SCHOOL_RADIUS;
      const position = school.center.clone().add(new Vector3(
        Math.cos(angle) * radius,
        (seededRandom() - 0.5) * 1.25,
        Math.sin(angle) * radius,
      ));
      const heading = seededRandom() * Math.PI * 2;
      const cruisingSpeed = 0.68 + seededRandom() * 0.34;
      const velocity = new Vector3(
        Math.cos(heading),
        (seededRandom() - 0.5) * 0.12,
        Math.sin(heading),
      ).normalize().multiplyScalar(cruisingSpeed);
      const scale = 0.46 + seededRandom() * 0.34;
      const isCurious = seededRandom() < 0.16;
      const individual: FishIndividual = {
        index: fishIndex,
        school: schoolIndex,
        position,
        velocity,
        acceleration: new Vector3(),
        scale,
        cruisingSpeed,
        phase: seededRandom() * Math.PI * 2,
        curiosity: isCurious ? 0.72 + seededRandom() * 0.28 : 0,
      };
      fish.push(individual);

      color.setHex(school.tint);
      color.offsetHSL(
        (seededRandom() - 0.5) * 0.045,
        (seededRandom() - 0.5) * 0.12,
        (seededRandom() - 0.5) * 0.16,
      );
      bodies.setColorAt(fishIndex, color);
      tails.setColorAt(fishIndex, color.clone().multiplyScalar(0.72));
      fishIndex += 1;
    }
  });
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  if (tails.instanceColor) tails.instanceColor.needsUpdate = true;

  const bodyTransform = new Object3D();
  const tailTransform = new Object3D();
  const bodyQuaternion = new Quaternion();
  const tailWagQuaternion = new Quaternion();
  const tailQuaternion = new Quaternion();
  const direction = new Vector3();
  const offset = new Vector3();
  const separation = new Vector3();
  const alignment = new Vector3();
  const cohesion = new Vector3();
  const desired = new Vector3();
  const schoolCenter = new Vector3();
  const cameraOffset = new Vector3();
  const cameraVelocity = new Vector3();
  const previousCameraPosition = new Vector3();
  const tangent = new Vector3();
  const sharkOffset = new Vector3();
  const sharkDir = new Vector3();
  const sharkForward = new Vector3();
  const lateralFlee = new Vector3();
  let hasCameraPosition = false;
  let lastTime: number | null = null;
  let cameraStillTime = 0;
  let lastCameraSpeed = 0;

  function getSchoolCenter(schoolIndex: number, time: number, target: Vector3): Vector3 {
    const preset = SCHOOL_PRESETS[schoolIndex];
    const phase = schoolIndex * 2.17;
    return target.copy(preset.center).add(new Vector3(
      Math.sin(time * 0.075 + phase) * 2.2,
      Math.sin(time * 0.11 + phase * 1.7) * 0.28,
      Math.cos(time * 0.061 + phase) * 2.5,
    ));
  }

  function updateMatrices(time: number) {
    for (const individual of fish) {
      direction.copy(individual.velocity).normalize();
      bodyQuaternion.setFromUnitVectors(FORWARD, direction);
      bodyTransform.position.copy(individual.position);
      bodyTransform.quaternion.copy(bodyQuaternion);
      bodyTransform.scale.set(
        individual.scale * 0.36,
        individual.scale * 0.21,
        individual.scale * 0.74,
      );
      bodyTransform.updateMatrix();
      bodies.setMatrixAt(individual.index, bodyTransform.matrix);

      const fishSpeed = individual.velocity.length();
      const tailFrequency = 3.2 + fishSpeed * 1.35;
      const tailEffort = MathUtils.smoothstep(
        fishSpeed,
        individual.cruisingSpeed * 0.72,
        individual.cruisingSpeed + 1.8,
      );
      const tailAngle = Math.sin(time * tailFrequency + individual.phase)
        * MathUtils.lerp(0.14, 0.31, tailEffort);
      tailWagQuaternion.setFromAxisAngle(UP, tailAngle);
      tailQuaternion.copy(bodyQuaternion).multiply(tailWagQuaternion);
      tailTransform.position.copy(individual.position);
      tailTransform.quaternion.copy(tailQuaternion);
      tailTransform.scale.setScalar(individual.scale);
      tailTransform.updateMatrix();
      tails.setMatrixAt(individual.index, tailTransform.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    tails.instanceMatrix.needsUpdate = true;
  }

  function update(
    time: number,
    underwaterMix: number,
    camera: Camera,
    sharkPosition?: Vector3,
    sharkVelocity?: Vector3
  ) {
    fishUniforms.uTime.value = time;
    fishUniforms.uUnderwater.value = underwaterMix;

    const rawDelta = lastTime === null ? 0 : time - lastTime;
    const delta = MathUtils.clamp(rawDelta, 0, 1 / 20);
    lastTime = time;

    if (!hasCameraPosition) {
      previousCameraPosition.copy(camera.position);
      hasCameraPosition = true;
    }
    if (delta > 0) {
      cameraVelocity.copy(camera.position).sub(previousCameraPosition).divideScalar(delta);
      clampVectorLength(cameraVelocity, 8);
    } else {
      cameraVelocity.set(0, 0, 0);
    }
    previousCameraPosition.copy(camera.position);
    lastCameraSpeed = cameraVelocity.length();
    const cameraIsUnderwater = underwaterMix > 0.5;
    if (cameraIsUnderwater && lastCameraSpeed < 0.075) {
      cameraStillTime += delta;
    } else if (lastCameraSpeed > 0.65) {
      cameraStillTime = 0;
    } else {
      cameraStillTime = Math.max(0, cameraStillTime - delta * 2.8);
    }
    const calmness = MathUtils.smoothstep(cameraStillTime, 1.6, 5.2);
    const curiosityCalmness = MathUtils.smoothstep(
      cameraStillTime,
      0.7,
      2.6,
    );

    if (delta > 0) {
      for (const individual of fish) {
        separation.set(0, 0, 0);
        alignment.set(0, 0, 0);
        cohesion.set(0, 0, 0);
        let separationCount = 0;
        let neighborCount = 0;

        for (const neighbor of fish) {
          if (neighbor === individual || neighbor.school !== individual.school) continue;
          offset.copy(neighbor.position).sub(individual.position);
          const distanceSquared = offset.lengthSq();
          if (distanceSquared < 10.5) {
            alignment.add(neighbor.velocity);
            cohesion.add(neighbor.position);
            neighborCount += 1;
          }
          if (distanceSquared > 0.0001
            && distanceSquared < SEPARATION_RADIUS * SEPARATION_RADIUS) {
            separation.addScaledVector(offset, -1 / distanceSquared);
            separationCount += 1;
          }
        }

        individual.acceleration.set(0, 0, 0);
        if (separationCount > 0) {
          separation.divideScalar(separationCount);
          clampVectorLength(separation, 1.8);
          individual.acceleration.addScaledVector(separation, 1.55);
        }
        if (neighborCount > 0) {
          alignment.divideScalar(neighborCount).sub(individual.velocity);
          cohesion.divideScalar(neighborCount).sub(individual.position);
          cohesion.y *= 0.42;
          individual.acceleration.addScaledVector(alignment, 0.68);
          individual.acceleration.addScaledVector(cohesion, 0.23);
        }

        getSchoolCenter(individual.school, time, schoolCenter);
        desired.copy(schoolCenter).sub(individual.position);
        desired.y *= 0.55;
        if (desired.lengthSq() > 12.0) {
          desired.normalize().multiplyScalar(individual.cruisingSpeed);
          individual.acceleration.addScaledVector(
            desired.sub(individual.velocity),
            0.58,
          );
        }

        const wanderPhase = time * 0.31 + individual.phase;
        individual.acceleration.x += Math.sin(wanderPhase * 1.17) * 0.055;
        individual.acceleration.y += Math.sin(wanderPhase * 0.73) * 0.022;
        individual.acceleration.z += Math.cos(wanderPhase * 0.91) * 0.055;

        // Camera avoidance
        desired.copy(camera.position).addScaledVector(cameraVelocity, 0.18);
        cameraOffset.copy(individual.position).sub(desired);
        const cameraDistance = cameraOffset.length();
        let panic = 0;
        if (cameraIsUnderwater) {
          const noticeRadius = CAMERA_NOTICE_RADIUS
            + Math.min(lastCameraSpeed * 0.45, 3.0);
          if (cameraDistance < noticeRadius) {
            panic = Math.sqrt(1 - MathUtils.smoothstep(
              cameraDistance,
              1.05,
              noticeRadius,
            ));
            const habituation = individual.curiosity > 0
              ? curiosityCalmness * 0.97
              : calmness * 0.72;
            const personalSpace = 1 - MathUtils.smoothstep(
              cameraDistance,
              0.9,
              2.7,
            );
            const fear = Math.max(personalSpace, panic * (1 - habituation));
            cameraOffset.normalize();
            individual.acceleration.addScaledVector(
              cameraOffset,
              fear * (4.4 + Math.min(lastCameraSpeed * 0.48, 2.1)),
            );
            if (lastCameraSpeed > 0.2) {
              individual.acceleration.addScaledVector(
                cameraVelocity,
                -fear * 0.20,
              );
            }
          }
        }

        // Shark predator avoidance
        let sharkPanic = 0;
        if (sharkPosition) {
          sharkOffset.copy(individual.position).sub(sharkPosition);
          const sharkDistance = sharkOffset.length();
          if (sharkDistance < SHARK_NOTICE_RADIUS && sharkDistance > 0.001) {
            sharkPanic = Math.sqrt(1 - MathUtils.smoothstep(
              sharkDistance,
              0.8,
              SHARK_NOTICE_RADIUS
            ));
            sharkDir.copy(sharkOffset).normalize();
            let threatMultiplier = 1.0;
            if (sharkVelocity && sharkVelocity.lengthSq() > 0.01) {
              sharkForward.copy(sharkVelocity).normalize();
              const headingDot = -sharkForward.dot(sharkDir);
              if (headingDot > 0.1) {
                threatMultiplier = 1.0 + headingDot * 1.8;
                lateralFlee.crossVectors(UP, sharkForward).normalize();
                if (lateralFlee.dot(sharkOffset) < 0) {
                  lateralFlee.negate();
                }
                individual.acceleration.addScaledVector(
                  lateralFlee,
                  sharkPanic * threatMultiplier * 3.8
                );
              }
            }
            individual.acceleration.addScaledVector(
              sharkDir,
              sharkPanic * threatMultiplier * 7.5
            );
          }
        }

        if (cameraIsUnderwater
          && individual.curiosity > 0
          && curiosityCalmness > 0.10
          && sharkPanic < 0.15) {
          cameraOffset.copy(camera.position).sub(individual.position);
          const distanceToCamera = cameraOffset.length();
          if (distanceToCamera < 11.5 && distanceToCamera > 1.55) {
            direction.copy(cameraOffset).normalize();
            tangent.crossVectors(UP, direction).normalize();
            const orbitRadius = 2.8 + individual.curiosity * 1.5;
            desired.copy(direction).multiplyScalar((distanceToCamera - orbitRadius) * 0.42);
            desired.addScaledVector(tangent, individual.cruisingSpeed * 1.05);
            desired.y += (camera.position.y - 0.15 - individual.position.y) * 0.20;
            individual.acceleration.addScaledVector(
              desired,
              curiosityCalmness * individual.curiosity * 1.05,
            );
          }
        }

        const surface = sampleOceanSurface(
          individual.position.x,
          individual.position.z,
          time,
        ).height;
        const floor = seabedHeight(individual.position.x, individual.position.z);
        const ceilingDistance = surface - 0.48 - individual.position.y;
        const floorDistance = individual.position.y - floor - 0.38;
        if (ceilingDistance < 0.62) individual.acceleration.y -= (0.62 - ceilingDistance) * 1.6;
        if (floorDistance < 0.52) individual.acceleration.y += (0.52 - floorDistance) * 1.8;

        individual.acceleration.y *= 0.62;
        clampVectorLength(individual.acceleration, 5.8);
        individual.velocity.addScaledVector(individual.acceleration, delta);
        individual.velocity.y = MathUtils.clamp(
          individual.velocity.y,
          -0.17,
          0.17,
        );
        const combinedPanic = Math.max(panic, sharkPanic * 1.6);
        const panicSpeed = combinedPanic * 2.4
          + Math.min(lastCameraSpeed * panic * 0.15, 0.85);
        const maximumSpeed = individual.cruisingSpeed + 0.38 + panicSpeed;
        clampVectorLength(individual.velocity, maximumSpeed);
        if (individual.velocity.length() < individual.cruisingSpeed * 0.72) {
          individual.velocity.setLength(individual.cruisingSpeed * 0.72);
        }
        individual.position.addScaledVector(individual.velocity, delta);
      }
    }

    updateMatrices(time);
  }

  function getDiagnostics(camera: Camera) {
    let nearbyCount = 0;
    let fleeingCount = 0;
    let curiousNearby = 0;
    let radialVelocity = 0;
    let totalSpeed = 0;
    for (const individual of fish) {
      totalSpeed += individual.velocity.length();
      cameraOffset.copy(individual.position).sub(camera.position);
      const distance = cameraOffset.length();
      if (distance < CAMERA_NOTICE_RADIUS) {
        nearbyCount += 1;
        const radial = individual.velocity.dot(cameraOffset.normalize());
        radialVelocity += radial;
        if (radial > 0.16) fleeingCount += 1;
        if (individual.curiosity > 0) curiousNearby += 1;
      }
    }
    return {
      count: fishCount,
      nearbyCount,
      fleeingCount,
      curiousNearby,
      averageRadialVelocity: nearbyCount > 0 ? radialVelocity / nearbyCount : 0,
      averageSpeed: totalSpeed / fishCount,
      averageTailHz: (3.2 + (totalSpeed / fishCount) * 1.35)
        / (Math.PI * 2),
      cameraSpeed: lastCameraSpeed,
      calmness: MathUtils.smoothstep(cameraStillTime, 1.6, 5.2),
    };
  }

  updateMatrices(0);

  return {
    underwaterObjects: [bodies, tails],
    update,
    getDiagnostics,
  };
}
