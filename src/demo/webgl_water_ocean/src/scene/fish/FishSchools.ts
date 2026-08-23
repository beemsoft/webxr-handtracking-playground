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
import { seabedHeight } from '../environment/Seabed';

const FORWARD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const SCHOOL_RADIUS = 3.6;
const SEPARATION_RADIUS = 0.75;
const SHARK_NOTICE_RADIUS = 7.5;

const SCHOOL_PRESETS = [
  { center: new Vector3(3.8, -1.8, 3.5), count: 18, tint: 0x69c5ba },
  { center: new Vector3(-5.8, -2.1, -2.8), count: 16, tint: 0x8abcb5 },
  { center: new Vector3(1.2, -1.5, -6.5), count: 14, tint: 0xd0bc7b },
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
}

export interface FishSchoolsController {
  underwaterObjects: Object3D[];
  update(
    time: number,
    underwaterMix: number,
    camera: Camera,
    waterTexture: any,
    causticTexture: any,
    sunDirection: Vector3,
    sharkPosition?: Vector3,
    sharkVelocity?: Vector3,
    onSurfaceRipple?: (x: number, z: number, strength: number, radius: number) => void,
    fogColor?: Color
  ): void;
}

export function createFishSchools(scene: Scene, sunDirection: Vector3): FishSchoolsController {
  let randomState = 0x5eaf00d;
  function seededRandom(): number {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  const fishUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection.clone() },
    uCausticTex: { value: null },
    uFogColor: { value: new Color(0x063542) },
  };

  const applyCausticsAnd10mFog = (mat: MeshStandardMaterial, cacheKey: string) => {
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uTime = fishUniforms.uTime;
      shader.uniforms.uUnderwater = fishUniforms.uUnderwater;
      shader.uniforms.uSunDirection = fishUniforms.uSunDirection;
      shader.uniforms.uCausticTex = fishUniforms.uCausticTex;
      shader.uniforms.uFogColor = fishUniforms.uFogColor;

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
        uniform sampler2D uCausticTex;
        uniform vec3 uFogColor;

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
          const float IOR_AIR = 1.0;
          const float IOR_WATER = 1.333;
          const vec3 underwaterColor = vec3(0.35, 0.85, 0.95);
          vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
          vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

          vec4 simCaust = texture2D(uCausticTex, causticCoord * 0.05 + 0.5);

          float cA = fishValueNoise(
            causticCoord * 0.85 + vec2(
              sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
              cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
            ) + vec2(uTime * 0.08, -uTime * 0.06)
          );
          float cB = fishValueNoise(causticCoord * 1.7 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08));
          float caustic = pow(cA, 1.6) * mix(0.20, 1.0, cB);
          float causticBreak = 0.25 + smoothstep(0.40, 0.75, fishValueNoise(causticCoord * 0.6 + vec2(uTime * 0.02, -uTime * 0.018))) * 0.75;
          caustic *= causticBreak;

          float totalCaust = caustic * 0.75 + simCaust.r * 1.5;
          float diffuseCaustic = max(0.0, dot(refractedLight, normalize(vCustomWorldNormal)));
          vec3 causticColor = underwaterColor * (totalCaust * 1.7) * (0.35 + diffuseCaustic * 0.65);
          outgoingLight += causticColor * (0.45 + outgoingLight * 0.55);

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

  const totalFishCount = SCHOOL_PRESETS.reduce((acc, preset) => acc + preset.count, 0);

  const bodyGeometry = new SphereGeometry(0.35, 12, 8);
  bodyGeometry.scale(0.38, 0.52, 1.25);
  bodyGeometry.computeVertexNormals();

  const bodyMaterial = new MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.15,
    color: 0xffffff,
  });
  applyCausticsAnd10mFog(bodyMaterial, 'fish_body_caustic_fog');

  const tailGeometry = createTailGeometry();
  const tailMaterial = new MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.08,
    side: DoubleSide,
    color: 0xffffff,
  });
  applyCausticsAnd10mFog(tailMaterial, 'fish_tail_caustic_fog');

  const bodyMesh = new InstancedMesh(bodyGeometry, bodyMaterial, totalFishCount);
  const tailMesh = new InstancedMesh(tailGeometry, tailMaterial, totalFishCount);
  bodyMesh.name = 'FishBodies';
  tailMesh.name = 'FishTails';
  scene.add(bodyMesh);
  scene.add(tailMesh);

  const fishList: FishIndividual[] = [];
  const schoolCenters = SCHOOL_PRESETS.map((preset) => preset.center.clone());
  const schoolAnchors = SCHOOL_PRESETS.map((preset) => preset.center.clone());

  let globalIndex = 0;
  SCHOOL_PRESETS.forEach((preset, schoolIndex) => {
    for (let i = 0; i < preset.count; i++) {
      const position = preset.center.clone().add(new Vector3(
        (seededRandom() - 0.5) * SCHOOL_RADIUS,
        (seededRandom() - 0.5) * 1.2,
        (seededRandom() - 0.5) * SCHOOL_RADIUS
      ));
      const velocity = new Vector3(
        seededRandom() - 0.5,
        (seededRandom() - 0.5) * 0.2,
        seededRandom() - 0.5
      ).normalize().multiplyScalar(0.8 + seededRandom() * 0.6);

      fishList.push({
        index: globalIndex,
        school: schoolIndex,
        position,
        velocity,
        acceleration: new Vector3(),
        scale: 0.55 + seededRandom() * 0.35,
        cruisingSpeed: 0.9 + seededRandom() * 0.4,
        phase: seededRandom() * Math.PI * 2,
      });

      const color = new Color(preset.tint);
      bodyMesh.setColorAt(globalIndex, color);
      tailMesh.setColorAt(globalIndex, color);
      globalIndex += 1;
    }
  });
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  if (tailMesh.instanceColor) tailMesh.instanceColor.needsUpdate = true;

  const dummy = new Object3D();
  const tailDummy = new Object3D();
  const fishRotation = new Quaternion();
  const tailLocalRotation = new Quaternion();
  const workVector = new Vector3();

  return {
    underwaterObjects: [bodyMesh, tailMesh],
    update(time, underwaterMix, camera, waterTexture, causticTexture, sunDir, sharkPos, sharkVel, onSurfaceRipple, fogColor) {
      fishUniforms.uTime.value = time;
      fishUniforms.uUnderwater.value = underwaterMix;
      fishUniforms.uSunDirection.value.copy(sunDir);
      fishUniforms.uCausticTex.value = causticTexture;
      if (fogColor) {
        fishUniforms.uFogColor.value.copy(fogColor);
      }

      // Update school center anchors
      schoolAnchors.forEach((anchor, sIdx) => {
        anchor.x = SCHOOL_PRESETS[sIdx].center.x + Math.sin(time * 0.15 + sIdx * 2.0) * 3.5;
        anchor.z = SCHOOL_PRESETS[sIdx].center.z + Math.cos(time * 0.12 + sIdx * 1.5) * 3.5;
      });

      // Update fish flocking
      const delta = 0.016;
      for (let i = 0; i < fishList.length; i++) {
        const fish = fishList[i];
        fish.acceleration.set(0, 0, 0);

        // Cohesion to school anchor
        const anchor = schoolAnchors[fish.school];
        const toAnchor = workVector.copy(anchor).sub(fish.position);
        const distToAnchor = toAnchor.length();
        if (distToAnchor > 0.1) {
          fish.acceleration.addScaledVector(toAnchor.normalize(), Math.min(distToAnchor * 0.6, 2.0));
        }

        // Separation from neighbor fish
        for (let j = 0; j < fishList.length; j++) {
          if (i === j) continue;
          const other = fishList[j];
          const diff = other.position.distanceTo(fish.position);
          if (diff < SEPARATION_RADIUS && diff > 0.001) {
            const repulse = workVector.copy(fish.position).sub(other.position).normalize();
            fish.acceleration.addScaledVector(repulse, (SEPARATION_RADIUS - diff) * 4.0);
          }
        }

        // Shark evasion
        if (sharkPos) {
          const distToShark = fish.position.distanceTo(sharkPos);
          if (distToShark < SHARK_NOTICE_RADIUS) {
            const flee = workVector.copy(fish.position).sub(sharkPos);
            // Deflect upward fleeing away if already high in the water column
            if (flee.y > 0 && fish.position.y > -0.7) {
              flee.y *= Math.max(0, (-0.25 - fish.position.y) / 0.45);
            }
            if (flee.lengthSq() > 0.001) {
              flee.normalize();
              fish.acceleration.addScaledVector(flee, (SHARK_NOTICE_RADIUS - distToShark) * 6.0);
            }
          }
        }

        // Boundary constraint: keep fish safely underwater (below y = -0.22) and above seabed
        const floorY = seabedHeight(fish.position.x, fish.position.z) + 0.55;
        if (fish.position.y < floorY) {
          fish.acceleration.y += (floorY - fish.position.y) * 12.0;
        }

        const SURFACE_SOFT_CEILING = -0.45;
        const MAX_FISH_Y = -0.22; // Ensures fish dorsal fin and body stay submerged
        if (fish.position.y > SURFACE_SOFT_CEILING) {
          fish.acceleration.y -= (fish.position.y - SURFACE_SOFT_CEILING) * 16.0;
          if (fish.velocity.y > 0) {
            fish.velocity.y *= 0.82; // Damp upward momentum near surface
          }
        }

        // Integrate
        fish.velocity.addScaledVector(fish.acceleration, delta);
        clampVectorLength(fish.velocity, 2.8);
        fish.position.addScaledVector(fish.velocity, delta);

        // Strict hard clamp to prevent popping out above water
        if (fish.position.y > MAX_FISH_Y) {
          fish.position.y = MAX_FISH_Y;
          if (fish.velocity.y > 0) fish.velocity.y = -0.05;
        }
        if (fish.position.y < floorY) {
          fish.position.y = floorY;
          if (fish.velocity.y < 0) fish.velocity.y = 0.05;
        }

        // Check surface touch / near surface ripple
        if (onSurfaceRipple && fish.position.y >= -0.35) {
          const depthProximity = MathUtils.clamp(1.0 - Math.abs(fish.position.y + 0.22) / 0.15, 0.0, 1.0);
          const speed = fish.velocity.length();
          const rippleStrength = (0.012 + speed * 0.008) * depthProximity;
          const rippleRadius = 0.004 + fish.scale * 0.003;
          onSurfaceRipple(fish.position.x, fish.position.z, rippleStrength, rippleRadius);
        }

        // Orient fish along velocity vector
        if (fish.velocity.lengthSq() > 0.001) {
          fishRotation.setFromUnitVectors(FORWARD, workVector.copy(fish.velocity).normalize());
        }

        // Body transform
        dummy.position.copy(fish.position);
        dummy.quaternion.copy(fishRotation);
        dummy.scale.setScalar(fish.scale);
        dummy.updateMatrix();
        bodyMesh.setMatrixAt(fish.index, dummy.matrix);

        // Tail wagging animation
        const wag = Math.sin(time * 6.5 * (fish.velocity.length() + 0.4) + fish.phase) * 0.45;
        tailLocalRotation.setFromAxisAngle(UP, wag);
        tailDummy.position.copy(fish.position);
        tailDummy.quaternion.copy(fishRotation).multiply(tailLocalRotation);
        tailDummy.scale.setScalar(fish.scale);
        tailDummy.updateMatrix();
        tailMesh.setMatrixAt(fish.index, tailDummy.matrix);
      }

      bodyMesh.instanceMatrix.needsUpdate = true;
      tailMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
